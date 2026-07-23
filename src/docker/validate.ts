import { isAbsolute, normalize, resolve, sep } from "node:path";
import { assertValidTaskId } from "../artifacts/names.js";
import { assessToolCall, operationHash, type RiskAssessment } from "../security/assess-risk.js";
import type { ApprovalService } from "../security/approval.js";
import type { DockerExecutionPolicy, ExecutionRequest } from "./types.js";
import { DockerExecutionError } from "./types.js";

const SENSITIVE_ENV_RE =
  /(api[_-]?key|token|secret|password|authorization|private[_-]?key|aws_|ssh)/i;

const FORBIDDEN_MOUNT_HINTS = [
  "docker.sock",
  "/var/run/docker.sock",
  "\\\\.\\pipe\\docker",
];

export interface ValidatedExecution {
  request: ExecutionRequest;
  policy: DockerExecutionPolicy;
  assessment: RiskAssessment;
  operationHash: string;
  repositoryMountMode: "read-only" | "read-write";
  networkMode: "none" | "restricted";
}

export interface ValidateExecutionOptions {
  request: ExecutionRequest;
  policy: DockerExecutionPolicy;
  /** Absolute path that must never be targeted (e.g. pi-upstream). */
  forbiddenRoots?: string[];
  approvalService?: ApprovalService;
  /** Host path that counts as "home" and must never be mounted. */
  hostHomePath?: string;
}

function isPathInside(root: string, candidate: string): boolean {
  const r = resolve(root);
  const c = resolve(candidate);
  if (c === r) return true;
  const prefix = r.endsWith(sep) ? r : r + sep;
  return c.toLowerCase().startsWith(prefix.toLowerCase());
}

function assertNoForbiddenCallerFields(request: ExecutionRequest): void {
  const anyReq = request as unknown as Record<string, unknown>;
  const banned = [
    "mounts",
    "privileged",
    "hostNetwork",
    "networkMode",
    "pidMode",
    "ipcMode",
    "dockerArgs",
    "extraHosts",
    "devices",
    "capAdd",
  ];
  for (const key of banned) {
    if (key in anyReq && anyReq[key] !== undefined) {
      throw new DockerExecutionError(
        "POLICY_VIOLATION",
        `caller must not supply Docker host/security field: ${key}`,
      );
    }
  }
}

export function validateExecutionRequest(opts: ValidateExecutionOptions): ValidatedExecution {
  const { request, policy } = opts;
  assertNoForbiddenCallerFields(request);

  try {
    assertValidTaskId(request.taskId);
  } catch {
    throw new DockerExecutionError("INVALID_TASK_ID", `invalid taskId: ${request.taskId}`);
  }

  if (!Array.isArray(request.command) || request.command.length === 0) {
    throw new DockerExecutionError("INVALID_REQUEST", "command must be a non-empty string array");
  }
  if (request.command.some((c) => typeof c !== "string" || c.includes("\0"))) {
    throw new DockerExecutionError("INVALID_REQUEST", "command argv contains invalid entries");
  }

  // Block destructive patterns via joined argv assessment
  const joined = request.command.join(" ");
  const assessment = assessToolCall({
    toolName: "bash",
    input: { command: joined },
    workspaceRoot: request.repositoryPath,
    forbiddenRoots: opts.forbiddenRoots,
  });
  if (assessment.blocked) {
    throw new DockerExecutionError("COMMAND_BLOCKED", assessment.reasons.join("; "), {
      reasons: assessment.reasons,
    });
  }

  const repo = resolve(request.repositoryPath);
  if (!isAbsolute(repo) && !existsAsPathShape(request.repositoryPath)) {
    // still resolve relative — but require absolute for safety in executor
  }
  if (hasTraversal(request.repositoryPath) || hasTraversal(request.workingDirectory)) {
    throw new DockerExecutionError(
      "INVALID_REPOSITORY_PATH",
      "path traversal is not allowed in repositoryPath/workingDirectory",
    );
  }

  const absRepo = resolve(request.repositoryPath);
  const absWork = isAbsolute(request.workingDirectory)
    ? resolve(request.workingDirectory)
    : resolve(absRepo, request.workingDirectory);

  if (!isPathInside(absRepo, absWork)) {
    throw new DockerExecutionError(
      "INVALID_WORKING_DIRECTORY",
      "workingDirectory must be inside repositoryPath",
    );
  }

  for (const fr of opts.forbiddenRoots ?? []) {
    const f = resolve(fr);
    if (isPathInside(f, absRepo) || absRepo === f) {
      throw new DockerExecutionError(
        "INVALID_REPOSITORY_PATH",
        "repository path targets a forbidden root (e.g. pi-upstream)",
      );
    }
  }

  if (opts.hostHomePath) {
    const home = resolve(opts.hostHomePath);
    if (isPathInside(home, absRepo) || absRepo === home) {
      throw new DockerExecutionError(
        "INVALID_REPOSITORY_PATH",
        "refusing to use host home directory as repository mount",
      );
    }
  }

  for (const hint of FORBIDDEN_MOUNT_HINTS) {
    if (absRepo.toLowerCase().includes(hint) || joined.toLowerCase().includes(hint)) {
      throw new DockerExecutionError("POLICY_VIOLATION", "docker socket / forbidden mount hint");
    }
  }

  if (!policy.allowedImages.includes(request.image)) {
    throw new DockerExecutionError(
      "IMAGE_NOT_ALLOWED",
      `image not in allowlist: ${request.image}`,
    );
  }

  for (const [key, value] of Object.entries(request.environment ?? {})) {
    if (!policy.allowedEnvironmentVariables.includes(key)) {
      throw new DockerExecutionError(
        "INVALID_ENVIRONMENT",
        `environment variable not allowed: ${key}`,
      );
    }
    if (SENSITIVE_ENV_RE.test(key) || SENSITIVE_ENV_RE.test(value)) {
      throw new DockerExecutionError(
        "INVALID_ENVIRONMENT",
        `refusing sensitive-looking environment variable: ${key}`,
      );
    }
  }

  let networkMode: "none" | "restricted" = policy.networkMode;
  let repositoryMountMode: "read-only" | "read-write" = policy.repositoryMountMode;

  // Elevate risk for write/network
  let elevated = assessment;
  if (request.requiresWriteAccess) {
    repositoryMountMode = "read-write";
    elevated = {
      ...assessment,
      level:
        assessment.level === "low"
          ? "medium"
          : assessment.level === "medium"
            ? "high"
            : assessment.level,
      requiresApproval: true,
      reasons: [...assessment.reasons, "write access requested"],
    };
  }

  if (request.requiresNetwork) {
    networkMode = "restricted";
    elevated = {
      ...elevated,
      level: "high",
      requiresApproval: true,
      reasons: [...elevated.reasons, "network access requested"],
    };
  }

  return finalizeValidation({
    request,
    policy,
    assessment: elevated,
    absRepo,
    absWork,
    repositoryMountMode,
    networkMode,
    approvalService: opts.approvalService,
  });
}

function finalizeValidation(opts: {
  request: ExecutionRequest;
  policy: DockerExecutionPolicy;
  assessment: RiskAssessment;
  absRepo: string;
  absWork: string;
  repositoryMountMode: "read-only" | "read-write";
  networkMode: "none" | "restricted";
  approvalService?: ApprovalService;
}): ValidatedExecution {
  const {
    request,
    policy,
    assessment: elevated,
    absRepo,
    absWork,
    repositoryMountMode,
    networkMode,
    approvalService,
  } = opts;
  const joined = request.command.join(" ");

  if (request.requiresWriteAccess && !request.approvalId && elevated.requiresApproval) {
    throw new DockerExecutionError(
      "WRITE_ACCESS_NOT_ALLOWED",
      "write access requires a valid approvalId",
    );
  }
  if (request.requiresNetwork && !request.approvalId) {
    throw new DockerExecutionError(
      "NETWORK_NOT_ALLOWED",
      "network access requires a valid approvalId",
    );
  }

  const hashInput = {
    command: joined,
    image: request.image,
    repositoryPath: absRepo,
    requiresWriteAccess: request.requiresWriteAccess,
    requiresNetwork: Boolean(request.requiresNetwork),
  };
  const hash = operationHash("run_in_docker", elevated, hashInput);

  if (elevated.requiresApproval) {
    if (!request.approvalId || !approvalService) {
      throw new DockerExecutionError(
        "APPROVAL_REQUIRED",
        "this docker execution requires approval",
        { operationHash: hash },
      );
    }
    const check = approvalService.validateForOperation(
      request.approvalId,
      "run_in_docker",
      elevated,
      hashInput,
    );
    if (!check.ok) {
      throw new DockerExecutionError(
        "APPROVAL_INVALID",
        check.reason ?? "approval invalid",
      );
    }
  }

  return {
    request: {
      ...request,
      repositoryPath: absRepo,
      workingDirectory: absWork,
    },
    policy: {
      ...policy,
      networkMode,
      repositoryMountMode,
      timeoutMs: request.timeoutMs ?? policy.timeoutMs,
    },
    assessment: elevated,
    operationHash: hash,
    repositoryMountMode,
    networkMode,
  };
}

/** Exported for tests — builds the elevated assessment + hash used for approvals. */
export function buildExecutionApprovalMaterial(
  request: ExecutionRequest,
  _policy: DockerExecutionPolicy,
  forbiddenRoots: string[] = [],
): { assessment: RiskAssessment; hashInput: Record<string, unknown>; absRepo: string } {
  const joined = request.command.join(" ");
  let assessment = assessToolCall({
    toolName: "bash",
    input: { command: joined },
    workspaceRoot: request.repositoryPath,
    forbiddenRoots,
  });
  if (request.requiresWriteAccess) {
    assessment = {
      ...assessment,
      level:
        assessment.level === "low"
          ? "medium"
          : assessment.level === "medium"
            ? "high"
            : assessment.level,
      requiresApproval: true,
      reasons: [...assessment.reasons, "write access requested"],
    };
  }
  if (request.requiresNetwork) {
    assessment = {
      ...assessment,
      level: "high",
      requiresApproval: true,
      reasons: [...assessment.reasons, "network access requested"],
    };
  }
  const absRepo = resolve(request.repositoryPath);
  return {
    assessment,
    absRepo,
    hashInput: {
      command: joined,
      image: request.image,
      repositoryPath: absRepo,
      requiresWriteAccess: request.requiresWriteAccess,
      requiresNetwork: Boolean(request.requiresNetwork),
    },
  };
}

function hasTraversal(p: string): boolean {
  const n = normalize(p);
  return n.split(/[\\/]/).includes("..") || p.includes("\0");
}

function existsAsPathShape(p: string): boolean {
  return typeof p === "string" && p.length > 0;
}

/** Build docker run argv from validated request — never accepts arbitrary caller docker flags. */
export function buildDockerRunArgs(opts: {
  containerName: string;
  validated: ValidatedExecution;
}): string[] {
  const { containerName, validated } = opts;
  const { request, policy, repositoryMountMode, networkMode } = validated;
  const mountSuffix = repositoryMountMode === "read-only" ? ":ro" : "";
  const workRel = request.workingDirectory.startsWith(request.repositoryPath)
    ? request.workingDirectory.slice(request.repositoryPath.length).replace(/^[/\\]/, "")
    : "";
  const containerWork =
    workRel.length === 0
      ? policy.containerWorkspacePath
      : `${policy.containerWorkspacePath}/${workRel.replace(/\\/g, "/")}`;

  const args: string[] = [
    "run",
    "--name",
    containerName,
    "--rm",
    "--network",
    networkMode === "none" ? "none" : "bridge",
    "--read-only",
    "--user",
    policy.runAsUser,
    "--cpus",
    String(policy.cpuLimit),
    "--memory",
    `${policy.memoryLimitMb}m`,
    "--pids-limit",
    String(policy.pidsLimit),
    "--security-opt",
    "no-new-privileges",
    "--cap-drop",
    "ALL",
    "--tmpfs",
    "/tmp:rw,noexec,nosuid,size=64m",
    "-v",
    `${request.repositoryPath}:${policy.containerWorkspacePath}${mountSuffix}`,
    "-w",
    containerWork,
  ];

  // Writable scratch stays on /tmp tmpfs only — never under the (often read-only) repo mount.
  for (const [k, v] of Object.entries(request.environment)) {
    args.push("-e", `${k}=${v}`);
  }

  args.push(request.image, ...request.command);
  return args;
}
