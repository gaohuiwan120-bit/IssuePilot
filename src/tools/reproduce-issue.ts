import type { ReproductionResult } from "../schema/types.js";
import { DockerExecutor } from "../docker/executor.js";
import { loadDockerPolicy } from "../docker/policy.js";
import { detectDockerAvailability } from "../docker/availability.js";
import { DockerExecutionError } from "../docker/types.js";
import type { ApprovalService } from "../security/approval.js";
import { ToolRuntime } from "./context.js";
import { IssueToolError } from "./errors.js";

export type ReproductionStatus =
  | "reproduced"
  | "not_reproduced"
  | "environment_incomplete"
  | "blocked"
  | "timeout"
  | "insufficient_evidence";

export interface ReproduceIssueInput {
  taskId: string;
  repositoryPath: string;
  commands: string[][];
  expectedFailure?: {
    exitCode?: number;
    stdoutPattern?: string;
    stderrPattern?: string;
    failingTestName?: string;
  };
  approvalId?: string;
  image?: string;
  /** Injected for tests. */
  executor?: DockerExecutor;
  approvalService?: ApprovalService;
  skipAvailabilityCheck?: boolean;
}

export interface ReproduceIssueOutput extends ReproductionResult {
  status: ReproductionStatus;
}

export async function reproduceIssue(input: ReproduceIssueInput): Promise<ReproduceIssueOutput> {
  const started = Date.now();
  const runtime = new ToolRuntime(input.taskId, input.repositoryPath, { stage: "reproduce" });
  try {
    if (!Array.isArray(input.commands) || input.commands.length === 0) {
      throw new IssueToolError("INVALID_INPUT", "commands must be a non-empty argv list");
    }

    if (!input.skipAvailabilityCheck && !input.executor) {
      const avail = await detectDockerAvailability();
      if (!avail.available) {
        const result = baseResult(input.taskId, {
          status: "environment_incomplete",
          reproduced: false,
          failureReason: avail.reason ?? "docker unavailable",
          observedBehavior: "DOCKER_UNAVAILABLE",
          reproductionConfidence: 0,
        });
        runtime.store.writeJson("reproduction.json", result);
        runtime.trace("reproduce_issue", false, result.failureReason ?? "docker unavailable", {
          errorCode: "DOCKER_UNAVAILABLE",
          durationMs: Date.now() - started,
        });
        return result;
      }
    }

    const executor =
      input.executor ??
      new DockerExecutor({
        policy: loadDockerPolicy(),
        approvalService: input.approvalService,
        outputsRoot: runtime.outputsRoot,
        stage: "reproduce",
        skipAvailabilityCheck: input.skipAvailabilityCheck,
        skipImageCheck: Boolean(input.executor) || input.skipAvailabilityCheck,
      });

    const commands: string[] = [];
    const exitCodes: number[] = [];
    const logs: string[] = [];
    const failingTests: string[] = [];
    let blocked = false;
    let timedOut = false;
    let lastObs = "";

    for (const argv of input.commands) {
      if (!Array.isArray(argv) || argv.length === 0) {
        throw new IssueToolError("INVALID_INPUT", "each command must be a non-empty argv array");
      }
      commands.push(argv.join(" "));
      try {
        const policy = loadDockerPolicy();
        const execResult = await executor.execute({
          taskId: input.taskId,
          executionType: "reproduce",
          image: input.image ?? policy.image,
          command: argv,
          repositoryPath: runtime.repositoryPath,
          workingDirectory: runtime.repositoryPath,
          environment: { NODE_ENV: "test", CI: "1" },
          requiresWriteAccess: false,
          requiresNetwork: false,
          approvalId: input.approvalId,
        });
        exitCodes.push(execResult.exitCode ?? 125);
        logs.push(
          `cmd=${argv.join(" ")} exit=${execResult.exitCode} stdout=${execResult.stdoutSummary} stderr=${execResult.stderrSummary}`,
        );
        lastObs = execResult.stderrSummary || execResult.stdoutSummary || lastObs;
        if (execResult.timedOut) timedOut = true;
        if (execResult.errorCode === "COMMAND_BLOCKED" || execResult.errorCode === "POLICY_VIOLATION") {
          blocked = true;
        }
        const failName = input.expectedFailure?.failingTestName;
        if (failName && `${execResult.stdoutSummary}\n${execResult.stderrSummary}`.includes(failName)) {
          failingTests.push(failName);
        }
      } catch (e) {
        if (e instanceof DockerExecutionError) {
          if (e.code === "COMMAND_BLOCKED" || e.code === "POLICY_VIOLATION") blocked = true;
          if (e.code === "DOCKER_UNAVAILABLE") {
            const result = baseResult(input.taskId, {
              status: "environment_incomplete",
              reproduced: false,
              failureReason: e.message,
              commands,
              exitCodes,
              logs,
              observedBehavior: e.code,
              reproductionConfidence: 0,
            });
            runtime.store.writeJson("reproduction.json", result);
            runtime.trace("reproduce_issue", false, e.message, {
              errorCode: e.code,
              durationMs: Date.now() - started,
            });
            return result;
          }
          exitCodes.push(125);
          logs.push(`error=${e.code}:${e.message}`);
          lastObs = e.message;
        } else if (e instanceof IssueToolError) {
          throw e;
        } else {
          throw e;
        }
      }
    }

    if (blocked) {
      const result = baseResult(input.taskId, {
        status: "blocked",
        reproduced: false,
        failureReason: "command blocked by safety policy",
        commands,
        exitCodes,
        logs,
        failingTests,
        observedBehavior: lastObs,
        reproductionConfidence: 0,
      });
      runtime.store.writeJson("reproduction.json", result);
      runtime.trace("reproduce_issue", false, result.failureReason!, {
        errorCode: "COMMAND_BLOCKED",
        durationMs: Date.now() - started,
      });
      return result;
    }

    if (timedOut) {
      const result = baseResult(input.taskId, {
        status: "timeout",
        reproduced: false,
        failureReason: "execution timed out",
        commands,
        exitCodes,
        logs,
        failingTests,
        observedBehavior: lastObs,
        reproductionConfidence: 0.2,
      });
      runtime.store.writeJson("reproduction.json", result);
      runtime.trace("reproduce_issue", false, "timeout", {
        errorCode: "REPRODUCTION_INCOMPLETE",
        durationMs: Date.now() - started,
      });
      return result;
    }

    const expected = input.expectedFailure;
    const combined = logs.join("\n");
    let matched = false;
    let evidenceBits = 0;

    if (!expected) {
      // Without expected failure signature, non-zero exit alone is insufficient evidence
      const result = baseResult(input.taskId, {
        status: "insufficient_evidence",
        reproduced: false,
        failureReason: "no expectedFailure criteria provided; refuse to treat arbitrary failure as reproduction",
        commands,
        exitCodes,
        logs,
        failingTests,
        observedBehavior: lastObs,
        reproductionConfidence: 0.1,
        unreproducibleException: false,
      });
      runtime.store.writeJson("reproduction.json", result);
      runtime.trace("reproduce_issue", false, result.failureReason!, {
        durationMs: Date.now() - started,
      });
      return result;
    }

    if (expected.exitCode !== undefined && exitCodes.includes(expected.exitCode)) {
      matched = true;
      evidenceBits += 1;
    }
    if (expected.stdoutPattern && new RegExp(expected.stdoutPattern).test(combined)) {
      matched = true;
      evidenceBits += 1;
    }
    if (expected.stderrPattern && new RegExp(expected.stderrPattern).test(combined)) {
      matched = true;
      evidenceBits += 1;
    }
    if (expected.failingTestName && failingTests.includes(expected.failingTestName)) {
      matched = true;
      evidenceBits += 1;
    }

    // Non-zero alone without matching expected signature => not reproduced
    if (!matched) {
      const result = baseResult(input.taskId, {
        status: "not_reproduced",
        reproduced: false,
        failureReason: "execution finished but expected failure signature did not match",
        commands,
        exitCodes,
        logs,
        failingTests,
        observedBehavior: lastObs,
        reproductionConfidence: 0.25,
      });
      runtime.store.writeJson("reproduction.json", result);
      runtime.trace("reproduce_issue", true, "not_reproduced", {
        durationMs: Date.now() - started,
      });
      return result;
    }

    const result = baseResult(input.taskId, {
      status: "reproduced",
      reproduced: true,
      failureReason: null,
      commands,
      exitCodes,
      logs,
      failingTests,
      observedBehavior: lastObs || "expected failure signature matched",
      reproductionConfidence: Math.min(0.5 + evidenceBits * 0.15, 0.95),
    });
    runtime.store.writeJson("reproduction.json", result);
    runtime.trace("reproduce_issue", true, "reproduced", {
      durationMs: Date.now() - started,
    });
    return result;
  } catch (e) {
    runtime.trace("reproduce_issue", false, e instanceof Error ? e.message : String(e), {
      errorCode: e instanceof IssueToolError ? e.code : "REPRODUCTION_INCOMPLETE",
      durationMs: Date.now() - started,
    });
    throw e;
  }
}

function baseResult(
  taskId: string,
  partial: Partial<ReproduceIssueOutput> & Pick<ReproduceIssueOutput, "status" | "reproduced">,
): ReproduceIssueOutput {
  return {
    taskId,
    reproduced: partial.reproduced,
    commands: partial.commands ?? [],
    exitCodes: partial.exitCodes ?? [],
    observedBehavior: partial.observedBehavior ?? "",
    logs: partial.logs ?? [],
    failingTests: partial.failingTests ?? [],
    failureReason: partial.failureReason ?? null,
    reproductionConfidence: partial.reproductionConfidence ?? 0,
    unreproducibleException: partial.unreproducibleException,
    exceptionEvidence: partial.exceptionEvidence,
    status: partial.status,
  };
}
