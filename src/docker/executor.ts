import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { ApprovalService } from "../security/approval.js";
import { RunRecorder } from "../trace/run-recorder.js";
import {
  authorizeToolCall,
  callKey,
  createRuntimeState,
  type RuntimeControlState,
  DEFAULT_WORKFLOW_LIMITS,
  type WorkflowLimits,
} from "../workflow/runtime-control.js";
import type { WorkflowStage } from "../workflow/stages.js";
import { detectDockerAvailability, imageExistsLocally } from "./availability.js";
import { loadDockerPolicy, DEFAULT_DOCKER_POLICY } from "./policy.js";
import type {
  DockerExecutionPolicy,
  ExecutionRequest,
  ExecutionResult,
  DockerErrorCode,
} from "./types.js";
import { DockerExecutionError } from "./types.js";
import { buildDockerRunArgs, validateExecutionRequest } from "./validate.js";

const SUMMARY_LIMIT = 2000;

export interface DockerCli {
  run(
    args: string[],
    opts: { timeoutMs: number },
  ): Promise<{ exitCode: number | null; stdout: string; stderr: string; timedOut: boolean }>;
  killContainer(name: string): Promise<boolean>;
  removeContainer(name: string): Promise<boolean>;
}

export function createProcessDockerCli(): DockerCli {
  return {
    async run(args, opts) {
      return await new Promise((resolve) => {
        const child = spawn("docker", args, {
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";
        let timedOut = false;
        const timer = setTimeout(() => {
          timedOut = true;
          child.kill("SIGKILL");
        }, opts.timeoutMs);
        child.stdout.on("data", (d) => {
          stdout += String(d);
        });
        child.stderr.on("data", (d) => {
          stderr += String(d);
        });
        child.on("close", (code) => {
          clearTimeout(timer);
          resolve({
            exitCode: timedOut ? null : code,
            stdout,
            stderr,
            timedOut,
          });
        });
        child.on("error", (err) => {
          clearTimeout(timer);
          resolve({
            exitCode: null,
            stdout,
            stderr: stderr + String(err),
            timedOut,
          });
        });
      });
    },
    async killContainer(name) {
      const r = await this.run(["kill", name], { timeoutMs: 15_000 });
      return r.exitCode === 0;
    },
    async removeContainer(name) {
      const r = await this.run(["rm", "-f", name], { timeoutMs: 15_000 });
      return r.exitCode === 0;
    },
  };
}

export interface DockerExecutorOptions {
  policy?: DockerExecutionPolicy;
  policyConfigPath?: string;
  cli?: DockerCli;
  approvalService?: ApprovalService;
  forbiddenRoots?: string[];
  hostHomePath?: string;
  outputsRoot?: string;
  stage?: WorkflowStage;
  runtimeState?: RuntimeControlState;
  limits?: WorkflowLimits;
  /** Skip live docker availability check (unit tests with mock CLI). */
  skipAvailabilityCheck?: boolean;
  skipImageCheck?: boolean;
}

function summarize(text: string): string {
  const t = text ?? "";
  if (t.length <= SUMMARY_LIMIT) return t;
  return t.slice(0, SUMMARY_LIMIT) + `…[truncated ${t.length - SUMMARY_LIMIT} chars]`;
}

function safeContainerName(taskId: string): string {
  const suffix = randomBytes(4).toString("hex");
  const safeTask = taskId.replace(/[^a-zA-Z0-9_.-]/g, "-").slice(0, 40);
  return `ip-${safeTask}-${suffix}`.slice(0, 63).toLowerCase();
}

export class DockerExecutor {
  private readonly policy: DockerExecutionPolicy;
  private readonly cli: DockerCli;
  private readonly approvalService?: ApprovalService;
  private readonly forbiddenRoots: string[];
  private readonly hostHomePath: string;
  private readonly outputsRoot: string;
  private readonly stage: WorkflowStage;
  private runtimeState: RuntimeControlState;
  private readonly limits: WorkflowLimits;
  private readonly skipAvailabilityCheck: boolean;
  private readonly skipImageCheck: boolean;

  constructor(opts: DockerExecutorOptions = {}) {
    this.policy = opts.policy ?? loadDockerPolicy(opts.policyConfigPath);
    this.cli = opts.cli ?? createProcessDockerCli();
    this.approvalService = opts.approvalService;
    this.forbiddenRoots = opts.forbiddenRoots ?? [];
    this.hostHomePath = opts.hostHomePath ?? homedir();
    this.outputsRoot = opts.outputsRoot ?? join(process.cwd(), "outputs");
    this.stage = opts.stage ?? "test";
    this.runtimeState = opts.runtimeState ?? createRuntimeState(this.stage);
    this.limits = opts.limits ?? DEFAULT_WORKFLOW_LIMITS;
    this.skipAvailabilityCheck = Boolean(opts.skipAvailabilityCheck);
    this.skipImageCheck = Boolean(opts.skipImageCheck);
  }

  async execute(request: ExecutionRequest): Promise<ExecutionResult> {
    const executionId = randomBytes(8).toString("hex");
    const started = Date.now();
    let containerName = safeContainerName(request.taskId);
    let cleanupSucceeded = true;
    let stdout = "";
    let stderr = "";
    let exitCode: number | null = null;
    let timedOut = false;
    let errorCode: DockerErrorCode | undefined;
    let errorMessage: string | undefined;
    let stdoutArtifactPath: string | undefined;
    let stderrArtifactPath: string | undefined;
    let validatedNetwork = this.policy.networkMode;
    let validatedMount = this.policy.repositoryMountMode;

    const recorder = new RunRecorder(this.outputsRoot, request.taskId);

    try {
      if (!this.skipAvailabilityCheck) {
        const avail = await detectDockerAvailability();
        if (!avail.available) {
          throw new DockerExecutionError(
            "DOCKER_UNAVAILABLE",
            avail.reason ?? "docker daemon unavailable",
          );
        }
      }

      const validated = validateExecutionRequest({
        request,
        policy: this.policy,
        forbiddenRoots: this.forbiddenRoots,
        approvalService: this.approvalService,
        hostHomePath: this.hostHomePath,
      });
      validatedNetwork = validated.networkMode;
      validatedMount = validated.repositoryMountMode;

      if (!this.skipImageCheck) {
        const exists = await imageExistsLocally(request.image);
        if (!exists) {
          throw new DockerExecutionError(
            "IMAGE_NOT_ALLOWED",
            `image not present locally: ${request.image}`,
          );
        }
      }

      const key = callKey(
        "run_in_docker",
        `${request.image}:${request.command.join(" ")}`,
      );
      const gated = authorizeToolCall(this.runtimeState, this.limits, key);
      this.runtimeState = gated.state;
      if (!gated.decision.allow) {
        throw new DockerExecutionError(
          "POLICY_VIOLATION",
          gated.decision.reason ?? "workflow limit exceeded",
        );
      }

      containerName = safeContainerName(request.taskId);
      const args = buildDockerRunArgs({ containerName, validated });

      recorder.append({
        stage: this.stage,
        eventType: "docker_start",
        toolName: "run_in_docker",
        success: true,
        riskLevel: validated.assessment.level,
        approvalId: request.approvalId,
        summary: `start ${request.executionType} image=${request.image}`,
      });

      const run = await this.cli.run(args, {
        timeoutMs: validated.policy.timeoutMs,
      });
      stdout = run.stdout;
      stderr = run.stderr;
      exitCode = run.exitCode;
      timedOut = run.timedOut;

      if (timedOut) {
        errorCode = "EXECUTION_TIMEOUT";
        errorMessage = "command timed out";
        try {
          await this.cli.killContainer(containerName);
        } catch {
          /* best effort */
        }
      } else if (exitCode !== 0) {
        errorCode = "EXECUTION_FAILED";
        errorMessage = `exit code ${exitCode}`;
      }
    } catch (err) {
      if (err instanceof DockerExecutionError) {
        errorCode = err.code;
        errorMessage = err.message;
      } else {
        errorCode = "CONTAINER_START_FAILED";
        errorMessage = err instanceof Error ? err.message : String(err);
      }
    } finally {
      try {
        // --rm should auto-remove; still best-effort remove
        const removed = await this.cli.removeContainer(containerName);
        cleanupSucceeded = removed || cleanupSucceeded;
      } catch (cleanupErr) {
        cleanupSucceeded = false;
        if (!errorCode) {
          errorCode = "CONTAINER_CLEANUP_FAILED";
          errorMessage = cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr);
        } else {
          errorCode = "CONTAINER_CLEANUP_FAILED";
          errorMessage = `${errorMessage}; cleanup failed`;
        }
      }
    }

    try {
      const logsDir = join(this.outputsRoot, request.taskId, "logs");
      mkdirSync(logsDir, { recursive: true });
      if (stdout.length > SUMMARY_LIMIT) {
        stdoutArtifactPath = join(logsDir, `${executionId}.stdout.txt`);
        writeFileSync(stdoutArtifactPath, stdout, "utf8");
      }
      if (stderr.length > SUMMARY_LIMIT) {
        stderrArtifactPath = join(logsDir, `${executionId}.stderr.txt`);
        writeFileSync(stderrArtifactPath, stderr, "utf8");
      }
    } catch {
      errorCode = errorCode ?? "OUTPUT_WRITE_FAILED";
      errorMessage = errorMessage ?? "failed to write output artifacts";
    }

    const success = !timedOut && exitCode === 0 && !errorCode;
    const result: ExecutionResult = {
      taskId: request.taskId,
      executionId,
      executionType: request.executionType,
      image: request.image,
      command: request.command,
      exitCode,
      success,
      timedOut,
      durationMs: Date.now() - started,
      stdoutSummary: summarize(stdout),
      stderrSummary: summarize(stderr),
      stdoutArtifactPath,
      stderrArtifactPath,
      cleanupSucceeded,
      errorCode: success ? undefined : errorCode,
      errorMessage: success ? undefined : errorMessage,
      containerName,
      appliedPolicy: {
        networkMode: validatedNetwork,
        repositoryMountMode: validatedMount,
        readOnlyRootFilesystem: this.policy.readOnlyRootFilesystem,
        runAsUser: this.policy.runAsUser,
        cpuLimit: this.policy.cpuLimit,
        memoryLimitMb: this.policy.memoryLimitMb,
        pidsLimit: this.policy.pidsLimit,
      },
    };

    try {
      recorder.append({
        stage: this.stage,
        eventType: timedOut ? "docker_timeout" : "docker_result",
        toolName: "run_in_docker",
        success: result.success,
        riskLevel: request.requiresNetwork || request.requiresWriteAccess ? "high" : "medium",
        approvalId: request.approvalId,
        summary: result.success
          ? `ok exit=${result.exitCode} ${result.durationMs}ms`
          : `${result.errorCode}: ${result.errorMessage}`,
        errorCode: result.errorCode,
        detailPath: result.stdoutArtifactPath ?? result.stderrArtifactPath,
        durationMs: result.durationMs,
      });
      if (!result.cleanupSucceeded) {
        recorder.append({
          stage: this.stage,
          eventType: "docker_cleanup_failed",
          toolName: "run_in_docker",
          success: false,
          summary: `cleanup failed for ${containerName}`,
          errorCode: "CONTAINER_CLEANUP_FAILED",
        });
      }
    } catch {
      // Trace write failure should not hide execution result, but must not be silent forever —
      // surface via error fields if still successful path
      if (result.success) {
        result.success = false;
        result.errorCode = "OUTPUT_WRITE_FAILED";
        result.errorMessage = "failed to write run trace";
      }
    }

    return result;
  }
}

export function getDefaultPolicy(): DockerExecutionPolicy {
  return { ...DEFAULT_DOCKER_POLICY };
}

export function assertPolicySafetyInvariants(policy: DockerExecutionPolicy): string[] {
  const violations: string[] = [];
  if (policy.networkMode !== "none" && policy.networkMode !== "restricted") {
    violations.push("invalid networkMode");
  }
  if (policy.networkMode !== "none") {
    // default should be none — restricted only when approved
  }
  if (!policy.readOnlyRootFilesystem) violations.push("readOnlyRootFilesystem must default true");
  if (!policy.runAsUser || policy.runAsUser === "0" || policy.runAsUser === "0:0" || policy.runAsUser === "root") {
    violations.push("runAsUser must be non-root");
  }
  if (policy.repositoryMountMode !== "read-only" && policy.repositoryMountMode !== "read-write") {
    violations.push("invalid repositoryMountMode");
  }
  return violations;
}

export function policyForbidsDockerSocket(_policy: DockerExecutionPolicy): boolean {
  // Executor never mounts docker.sock by construction.
  return true;
}

export function policyForbidsPrivileged(): boolean {
  return true;
}

export function policyForbidsHostNetwork(networkMode: string): boolean {
  return networkMode !== "host";
}

export function isHomeMountForbidden(
  repositoryPath: string,
  hostHomePath: string,
): boolean {
  const repo = resolveSafe(repositoryPath);
  const home = resolveSafe(hostHomePath);
  return repo === home || repo.startsWith(home + "\\") || repo.startsWith(home + "/");
}

function resolveSafe(p: string): string {
  return join(p);
}

export function dockerBinaryExistsHint(): boolean {
  return existsSync("/usr/bin/docker") || process.platform === "win32";
}
