import type { ValidationResult, CommandResult } from "../schema/types.js";
import { DockerExecutor } from "../docker/executor.js";
import { loadDockerPolicy } from "../docker/policy.js";
import type { ApprovalService } from "../security/approval.js";
import { ToolRuntime } from "./context.js";
import { IssueToolError } from "./errors.js";

export interface RunValidationInput {
  taskId: string;
  repositoryPath: string;
  testCommands: string[][];
  buildCommands?: string[][];
  lintCommands?: string[][];
  reproductionCommands?: string[][];
  acceptanceCriteria: string[];
  approvalId?: string;
  image?: string;
  executor?: DockerExecutor;
  approvalService?: ApprovalService;
  skipAvailabilityCheck?: boolean;
  /** Heuristic checks against command logs for acceptance criteria keywords. */
  acceptanceEvidenceText?: string;
}

export async function runValidation(input: RunValidationInput): Promise<ValidationResult> {
  const started = Date.now();
  const runtime = new ToolRuntime(input.taskId, input.repositoryPath, { stage: "test" });
  try {
    const executor =
      input.executor ??
      new DockerExecutor({
        policy: loadDockerPolicy(),
        approvalService: input.approvalService,
        outputsRoot: runtime.outputsRoot,
        stage: "test",
        skipAvailabilityCheck: input.skipAvailabilityCheck,
        skipImageCheck: Boolean(input.executor) || input.skipAvailabilityCheck,
      });

    const allCommands: string[] = [];
    const results: CommandResult[] = [];
    let anyExecuted = false;
    let testsPassed = true;
    let buildPassed = true;
    let lintPassed = true;
    let reproductionTestPassed = true;
    let evidence = input.acceptanceEvidenceText ?? "";

    async function runGroup(
      group: string[][] | undefined,
      kind: "test" | "build" | "lint" | "reproduce",
      required: boolean,
    ): Promise<boolean> {
      if (!group || group.length === 0) {
        if (required) {
          results.push({
            command: `(no ${kind} commands)`,
            exitCode: -1,
            passed: false,
            outputSummary: `skipped: missing required ${kind} commands`,
          });
          return false;
        }
        results.push({
          command: `(optional ${kind})`,
          exitCode: 0,
          passed: true,
          outputSummary: `skipped: optional ${kind} not provided`,
        });
        return true;
      }
      let ok = true;
      for (const argv of group) {
        allCommands.push(argv.join(" "));
        anyExecuted = true;
        const policy = loadDockerPolicy();
        const execResult = await executor.execute({
          taskId: input.taskId,
          executionType:
            kind === "reproduce"
              ? "reproduce"
              : kind === "lint"
                ? "lint"
                : kind === "build"
                  ? "build"
                  : "test",
          image: input.image ?? policy.image,
          command: argv,
          repositoryPath: runtime.repositoryPath,
          workingDirectory: runtime.repositoryPath,
          environment: { NODE_ENV: "test", CI: "1" },
          requiresWriteAccess: false,
          requiresNetwork: false,
          approvalId: input.approvalId,
        });
        const passed = !execResult.timedOut && execResult.exitCode === 0;
        if (!passed) ok = false;
        evidence += `\n${execResult.stdoutSummary}\n${execResult.stderrSummary}`;
        results.push({
          command: argv.join(" "),
          exitCode: execResult.exitCode ?? 125,
          passed,
          durationMs: execResult.durationMs,
          outputSummary: (execResult.stdoutSummary || execResult.stderrSummary).slice(0, 500),
        });
      }
      return ok;
    }

    testsPassed = await runGroup(input.testCommands, "test", true);
    buildPassed = await runGroup(input.buildCommands, "build", false);
    lintPassed = await runGroup(input.lintCommands, "lint", false);
    reproductionTestPassed = await runGroup(input.reproductionCommands, "reproduce", false);

    const acceptanceCriteriaResults = (input.acceptanceCriteria ?? []).map((criterion) => {
      // Deterministic: criterion considered satisfied only if its significant tokens appear in evidence
      // AND testsPassed. Never invent pass without execution.
      const tokens = criterion
        .split(/[^A-Za-z0-9_]+/)
        .map((t) => t.toLowerCase())
        .filter((t) => t.length >= 4);
      const matched =
        testsPassed &&
        anyExecuted &&
        (tokens.length === 0 || tokens.some((t) => evidence.toLowerCase().includes(t)));
      return { criterion, satisfied: Boolean(matched) };
    });

    if (!anyExecuted) {
      const result: ValidationResult = {
        taskId: input.taskId,
        commands: allCommands,
        results,
        buildPassed: false,
        lintPassed: false,
        testsPassed: false,
        reproductionTestPassed: false,
        regressionTestsPassed: false,
        acceptanceCriteriaResults: (input.acceptanceCriteria ?? []).map((c) => ({
          criterion: c,
          satisfied: false,
        })),
        overallPassed: false,
        executed: false,
      };
      runtime.store.writeJson("validation.json", result);
      runtime.trace("run_validation", false, "no commands executed", {
        errorCode: "VALIDATION_NOT_EXECUTED",
        durationMs: Date.now() - started,
      });
      return result;
    }

    const acceptanceOk =
      acceptanceCriteriaResults.length === 0 ||
      acceptanceCriteriaResults.every((a) => a.satisfied);

    const overallPassed =
      testsPassed && buildPassed && lintPassed && reproductionTestPassed && acceptanceOk;

    const result: ValidationResult = {
      taskId: input.taskId,
      commands: allCommands,
      results,
      buildPassed,
      lintPassed,
      testsPassed,
      reproductionTestPassed,
      regressionTestsPassed: testsPassed,
      acceptanceCriteriaResults,
      overallPassed,
      executed: true,
    };
    runtime.store.writeJson("validation.json", result);
    runtime.trace("run_validation", overallPassed, `overallPassed=${overallPassed}`, {
      durationMs: Date.now() - started,
    });
    return result;
  } catch (e) {
    runtime.trace("run_validation", false, e instanceof Error ? e.message : String(e), {
      errorCode: e instanceof IssueToolError ? e.code : "VALIDATION_NOT_EXECUTED",
      durationMs: Date.now() - started,
    });
    throw e;
  }
}
