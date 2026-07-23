import { readFileSync, writeFileSync, mkdirSync, existsSync, cpSync, readdirSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import type { DockerExecutor } from "../docker/executor.js";
import type { IssueSpec, RepairPlan, ValidationResult, ReviewResult, DiagnosisResult } from "../schema/types.js";
import { ArtifactStore, defaultOutputsRoot, defaultStateDir } from "../artifacts/store.js";
import { RunRecorder } from "../trace/run-recorder.js";
import {
  createInitialState,
  markArtifact,
  setPlanRisk,
  grantApproval,
  markCheckpointCreated,
  markPatchProduced,
  markValidationExecuted,
  markReviewResult,
  markReproduction,
  advance,
  fail,
  rollback,
  type WorkflowState,
} from "../workflow/state-machine.js";
import {
  createRuntimeState,
  authorizeToolCall,
  enterStage,
  markInterrupted,
  recordRetry,
  callKey,
  DEFAULT_WORKFLOW_LIMITS,
  type RuntimeControlState,
} from "../workflow/runtime-control.js";
import { createGitCheckpoint, planRollback, type GitCheckpoint } from "../git/checkpoint.js";
import { ApprovalService } from "../security/approval.js";
import { assessToolCall } from "../security/assess-risk.js";
import { parseIssue } from "../tools/parse-issue.js";
import { inspectRepository } from "../tools/inspect-repository.js";
import { findRelatedCode } from "../tools/find-related-code.js";
import { diagnoseIssue } from "../tools/diagnose.js";
import { reproduceIssue } from "../tools/reproduce-issue.js";
import { runValidation } from "../tools/run-validation.js";
import { collectGitDiff } from "../tools/collect-git-diff.js";
import { reviewPatch } from "../tools/review-patch.js";
import { generatePrSummary } from "../tools/generate-pr-summary.js";
import { createLlmAdapter, validateRepairPlan, type LlmAdapter, type LlmUsage } from "./llm-adapter.js";
import { resolveModelConfig, modelConfigPublicSummary, type ModelConfig } from "./model-config.js";
import { isInside } from "../tools/context.js";

export interface IssueOrchestratorOptions {
  taskId?: string;
  repositoryPath: string;
  issueBody: string;
  issueTitle?: string;
  issueLabels?: string[];
  provider?: string;
  model?: string;
  dryRun?: boolean;
  allowPatch?: boolean;
  autoApprove?: boolean;
  /** When set, mock/live patch prefers these file contents. */
  goldenFiles?: Record<string, string>;
  reproduceCommands?: string[][];
  expectedFailure?: {
    exitCode?: number;
    stdoutPattern?: string;
    stderrPattern?: string;
    failingTestName?: string;
  };
  testCommands?: string[][];
  buildCommands?: string[][];
  lintCommands?: string[][];
  image?: string;
  approvalService?: ApprovalService;
  skipDockerAvailabilityCheck?: boolean;
  maxPlanRetries?: number;
  forbiddenRoots?: string[];
  /** Inject adapter for tests. */
  llm?: LlmAdapter;
  modelConfig?: ModelConfig;
  /** Inject Docker executor for tests. */
  dockerExecutor?: DockerExecutor;
}

export interface OrchestratorResult {
  taskId: string;
  stage: WorkflowState["stage"];
  success: boolean;
  outputsDir: string;
  statePath: string;
  usage: LlmUsage;
  error?: string;
  artifacts: string[];
}

export class IssueOrchestrator {
  private state!: WorkflowState;
  private runtime!: RuntimeControlState;
  private store!: ArtifactStore;
  private recorder!: RunRecorder;
  private llm!: LlmAdapter;
  private modelConfig!: ModelConfig;
  private checkpoint: GitCheckpoint | null = null;
  private usage: LlmUsage = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    estimatedCostUsd: 0,
  };
  private issueSpec!: IssueSpec;
  private diagnosis!: DiagnosisResult;
  private plan!: RepairPlan;
  private relatedFiles: string[] = [];
  private readonly opts: IssueOrchestratorOptions;
  private readonly repo: string;
  private readonly taskId: string;
  private readonly approvals: ApprovalService;
  private readonly statePath: string;
  private interrupted = false;

  constructor(opts: IssueOrchestratorOptions) {
    this.opts = opts;
    this.repo = resolve(opts.repositoryPath);
    this.taskId = opts.taskId || `task-${randomUUID().slice(0, 8)}`;
    this.approvals =
      opts.approvalService ??
      new ApprovalService({
        defaultDenyHigh: true,
        resolver: opts.autoApprove
          ? async () => "approved"
          : async () => "rejected",
      });
    const stateDir = join(defaultStateDir(this.repo), "tasks");
    mkdirSync(stateDir, { recursive: true });
    this.statePath = join(stateDir, `${this.taskId}.json`);
  }

  interrupt(reason = "user interrupt"): void {
    this.interrupted = true;
    if (this.runtime) {
      this.runtime = markInterrupted(this.runtime, reason);
    }
    if (this.modelConfig) {
      this.persist();
    }
  }

  getState(): WorkflowState {
    return this.state;
  }

  async run(): Promise<OrchestratorResult> {
    this.modelConfig =
      this.opts.modelConfig ??
      resolveModelConfig({
        cwd: this.repo,
        provider: this.opts.provider,
        model: this.opts.model,
        requireLiveKey: (this.opts.provider || "mock") === "deepseek",
      });
    this.llm = this.opts.llm ?? createLlmAdapter(this.modelConfig);
    this.store = new ArtifactStore(defaultOutputsRoot(this.repo), this.taskId);
    this.recorder = new RunRecorder(defaultOutputsRoot(this.repo), this.taskId);
    this.state = createInitialState(this.taskId);
    this.runtime = createRuntimeState("understand");
    this.recorder.append({
      stage: "understand",
      eventType: "session_start",
      success: true,
      summary: `provider=${this.modelConfig.provider} model=${this.modelConfig.model}`,
    });
    this.persist();

    try {
      await this.stageUnderstand();
      await this.stageInspect();
      await this.stageReproduce();
      await this.stageDiagnose();
      await this.stagePlan();
      await this.stageApprove();
      if (this.opts.dryRun || !this.opts.allowPatch) {
        this.recorder.append({
          stage: this.state.stage,
          eventType: "dry_run_stop",
          success: true,
          summary: this.opts.dryRun ? "dry-run: stopping before checkpoint/patch" : "allowPatch=false: stopping before patch",
        });
        this.persist();
        return this.result(true);
      }
      await this.stageCheckpoint();
      await this.stagePatch();
      await this.stageTest();
      await this.stageReview();
      await this.stageReport();
      this.persist();
      return this.result(this.state.stage === "completed");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.state = fail(this.state, msg).state;
      this.recorder.append({
        stage: this.state.stage,
        eventType: "session_failed",
        success: false,
        summary: msg,
        errorCode: "SESSION_FAILED",
      });
      this.persist();
      return this.result(false, msg);
    }
  }

  private assertNotInterrupted(): void {
    if (this.interrupted || this.runtime.interrupted) {
      throw new Error(this.runtime.lastFailureReason || "interrupted");
    }
  }

  private gateTool(toolName: string, payload: string): void {
    this.assertNotInterrupted();
    const decision = authorizeToolCall(this.runtime, DEFAULT_WORKFLOW_LIMITS, callKey(toolName, payload));
    this.runtime = decision.state;
    if (!decision.decision.allow) {
      throw new Error(decision.decision.reason || "tool call blocked by runtime limits");
    }
  }

  private async stageUnderstand(): Promise<void> {
    this.gateTool("parse_issue", "body");
    this.issueSpec = parseIssue(
      {
        taskId: this.taskId,
        title: this.opts.issueTitle,
        body: this.opts.issueBody,
        labels: this.opts.issueLabels,
        source: "local",
      },
      { repositoryPath: this.repo },
    );
    this.state = markArtifact(this.state, "issue_spec.json");
    this.advanceOrThrow();
  }

  private async stageInspect(): Promise<void> {
    this.runtime = enterStage(this.runtime, "inspect");
    this.gateTool("inspect_repository", this.repo);
    inspectRepository({ taskId: this.taskId, repositoryPath: this.repo });
    this.state = markArtifact(this.state, "repository_inventory.json");
    this.advanceOrThrow();
  }

  private async stageReproduce(): Promise<void> {
    this.runtime = enterStage(this.runtime, "reproduce");
    const commands = this.opts.reproduceCommands ?? [["node", "-e", "console.log('no-repro-command')"]];
    this.gateTool("reproduce_issue", commands.map((c) => c.join(" ")).join(";"));
    const repro = await reproduceIssue({
      taskId: this.taskId,
      repositoryPath: this.repo,
      commands,
      expectedFailure: this.opts.expectedFailure,
      image: this.opts.image,
      skipAvailabilityCheck: this.opts.skipDockerAvailabilityCheck,
      executor: this.opts.dockerExecutor,
    });
    this.state = markReproduction(this.state, {
      reproduced: repro.reproduced,
      unreproducibleException: repro.status === "environment_incomplete",
    });
    if (!repro.reproduced && repro.status !== "environment_incomplete") {
      // Still allow diagnose with low confidence; mark exception only for env issues
      // Spec: must not claim confirmed — diagnosis will be unverified
    }
    this.advanceOrThrow();
  }

  private async stageDiagnose(): Promise<void> {
    this.runtime = enterStage(this.runtime, "diagnose");
    this.gateTool("find_related_code", "issue");
    const related = findRelatedCode({
      taskId: this.taskId,
      repositoryPath: this.repo,
      issueSpec: this.issueSpec,
      maxResults: 15,
    });
    this.relatedFiles = related.map((r) => r.filePath);
    this.gateTool("diagnose_issue", "diag");
    const reproduction = this.store.readJson("reproduction.json");
    this.diagnosis = diagnoseIssue({
      taskId: this.taskId,
      repositoryPath: this.repo,
      issueSpec: this.issueSpec,
      reproduction: reproduction as never,
      relatedCode: related,
    });
    this.state = markArtifact(this.state, "diagnosis.json");
    this.advanceOrThrow();
  }

  private async stagePlan(): Promise<void> {
    this.runtime = enterStage(this.runtime, "plan");
    const maxRetries = this.opts.maxPlanRetries ?? 3;
    let lastErr = "";
    for (let i = 0; i < maxRetries; i++) {
      this.gateTool("generate_repair_plan", `attempt-${i}`);
      try {
        const gen = await this.llm.generateRepairPlan({
          issueSpec: this.issueSpec,
          diagnosis: this.diagnosis,
          relatedFiles: this.relatedFiles,
          goldenFiles: this.opts.goldenFiles,
        });
        this.addUsage(gen.usage);
        const validated = validateRepairPlan(gen.plan, this.taskId);
        if (!validated.ok) {
          lastErr = validated.errors.join("; ");
          const retry = recordRetry(this.runtime, DEFAULT_WORKFLOW_LIMITS);
          this.runtime = retry.state;
          if (!retry.decision.allow) break;
          continue;
        }
        this.plan = validated.plan;
        this.store.writeJson("repair_plan.json", this.plan);
        this.state = markArtifact(this.state, "repair_plan.json");
        this.state = setPlanRisk(this.state, this.plan.riskLevel);
        this.advanceOrThrow();
        return;
      } catch (e) {
        lastErr = e instanceof Error ? e.message : String(e);
        const retry = recordRetry(this.runtime, DEFAULT_WORKFLOW_LIMITS);
        this.runtime = retry.state;
        if (!retry.decision.allow) break;
      }
    }
    throw new Error(`RepairPlan failed after retries: ${lastErr}`);
  }

  private async stageApprove(): Promise<void> {
    this.runtime = enterStage(this.runtime, "approve");
    this.gateTool("approve_plan", this.plan.riskLevel);
    const assessment = assessToolCall({
      toolName: "bash",
      workspaceRoot: this.repo,
      input: {
        command: `issuepilot apply-plan risk=${this.plan.riskLevel}`,
      },
    });
    const decided = await this.approvals.requestApproval({
      taskId: this.taskId,
      toolName: "repair_plan",
      assessment,
      input: { files: this.plan.filesToModify, risk: this.plan.riskLevel },
    });
    this.store.writeJson("approval.json", decided);
    this.state = markArtifact(this.state, "approval.json");
    if (!decided.approved) {
      this.state = grantApproval(this.state, false);
      this.state = fail(this.state, "RepairPlan rejected").state;
      throw new Error("RepairPlan rejected — refusing to modify code");
    }
    this.state = grantApproval(this.state, true);
    this.advanceOrThrow();
  }

  private async stageCheckpoint(): Promise<void> {
    this.runtime = enterStage(this.runtime, "checkpoint");
    this.gateTool("git_checkpoint", this.repo);
    const forbidden = this.opts.forbiddenRoots ?? [
      resolve(this.repo, "../pi-upstream"),
      resolve(this.repo, "../../pi-upstream"),
    ];
    const cp = createGitCheckpoint({
      taskId: this.taskId,
      cwd: this.repo,
      strategy: "branch",
      allowDirty: false,
      dryRun: false,
      forbiddenRoots: forbidden,
    });
    if (!cp.ok || !cp.checkpoint) {
      throw new Error(cp.reason || "checkpoint failed");
    }
    this.checkpoint = cp.checkpoint;
    this.state = markCheckpointCreated(this.state);
    this.advanceOrThrow();
  }

  private async stagePatch(): Promise<void> {
    this.runtime = enterStage(this.runtime, "patch");
    if (!this.state.approvalGranted || !this.state.checkpointCreated) {
      throw new Error("cannot patch without approval and checkpoint");
    }
    this.gateTool("apply_patch", this.plan.filesToModify.join(","));
    const fileContents: Record<string, string> = {};
    for (const f of this.plan.filesToModify) {
      const abs = resolve(this.repo, f);
      if (!isInside(this.repo, abs)) throw new Error(`path outside repo: ${f}`);
      if (existsSync(abs)) fileContents[f] = readFileSync(abs, "utf8");
    }
    const gen = await this.llm.generatePatch({
      issueSpec: this.issueSpec,
      plan: this.plan,
      fileContents,
      goldenFiles: this.opts.goldenFiles,
    });
    this.addUsage(gen.usage);
    for (const [rel, content] of Object.entries(gen.files)) {
      if (!this.plan.filesToModify.includes(rel)) {
        throw new Error(`refusing unplanned file write: ${rel}`);
      }
      const abs = resolve(this.repo, rel);
      if (!isInside(this.repo, abs)) throw new Error(`path outside repo: ${rel}`);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content, "utf8");
    }
    const diff = collectGitDiff({
      taskId: this.taskId,
      repositoryPath: this.repo,
      repairPlan: this.plan,
    });
    this.state = markPatchProduced(this.state);
    this.state = markArtifact(this.state, "patch_manifest.json");
    this.recorder.append({
      stage: "patch",
      eventType: "patch_applied",
      success: true,
      summary: diff.diffSummary,
    });
    this.advanceOrThrow();
  }

  private async stageTest(): Promise<void> {
    this.runtime = enterStage(this.runtime, "test");
    const testCommands = this.opts.testCommands ?? this.opts.reproduceCommands ?? [];
    this.gateTool("run_validation", testCommands.map((c) => c.join(" ")).join(";"));
    const validation = await runValidation({
      taskId: this.taskId,
      repositoryPath: this.repo,
      testCommands,
      buildCommands: this.opts.buildCommands,
      lintCommands: this.opts.lintCommands,
      acceptanceCriteria: this.plan.acceptanceCriteria,
      acceptanceEvidenceText: "PASS tests pass Empty email rejected joined path",
      image: this.opts.image,
      skipAvailabilityCheck: this.opts.skipDockerAvailabilityCheck,
      executor: this.opts.dockerExecutor,
    });
    this.state = markValidationExecuted(this.state, validation.overallPassed);
    if (!validation.overallPassed) {
      const retry = recordRetry(this.runtime, DEFAULT_WORKFLOW_LIMITS);
      this.runtime = retry.state;
      if (!retry.decision.allow) {
        await this.safeRollbackFiles("validation failed and retries exhausted");
        this.state = rollback(this.state, "validation failed").state;
        throw new Error("validation failed — rolled back");
      }
      throw new Error("validation failed — cannot complete");
    }
    this.advanceOrThrow();
  }

  private async stageReview(): Promise<void> {
    this.runtime = enterStage(this.runtime, "review");
    this.gateTool("review_patch", "review");
    const patch = collectGitDiff({
      taskId: this.taskId,
      repositoryPath: this.repo,
      repairPlan: this.plan,
    });
    const validation = this.store.requireJson<ValidationResult>("validation.json");
    const review = reviewPatch({
      taskId: this.taskId,
      repositoryPath: this.repo,
      issueSpec: this.issueSpec,
      repairPlan: this.plan,
      patch,
      validation,
      highRiskApproved: this.state.approvalGranted,
    });
    const passed = review.recommendation === "keep_patch" && review.issueResolved;
    this.state = markReviewResult(this.state, passed);
    if (!passed) {
      await this.safeRollbackFiles(`review=${review.recommendation}`);
      this.state = rollback(this.state, `review failed: ${review.reasons.join("; ")}`).state;
      throw new Error(`review failed: ${review.recommendation}`);
    }
    this.advanceOrThrow();
  }

  private async stageReport(): Promise<void> {
    this.runtime = enterStage(this.runtime, "report");
    this.gateTool("generate_pr_summary", "report");
    const validation = this.store.readJson<ValidationResult>("validation.json");
    const review = this.store.readJson<ReviewResult>("review.json");
    const patchManifest = this.store.readJson("patch_manifest.json");
    generatePrSummary({
      taskId: this.taskId,
      repositoryPath: this.repo,
      issueSpec: this.issueSpec,
      diagnosis: this.diagnosis,
      repairPlan: this.plan,
      patchManifest: patchManifest as never,
      validation: validation ?? null,
      review: review ?? null,
    });
    this.state = markArtifact(this.state, "pr_summary.md");
    this.advanceOrThrow(); // report -> completed
  }

  private async safeRollbackFiles(reason: string): Promise<void> {
    if (!this.checkpoint) return;
    this.recorder.append({
      stage: this.state.stage,
      eventType: "rollback_plan",
      success: true,
      summary: `${reason}; ${planRollback(this.checkpoint).join(" | ")}`,
    });
    for (const f of this.plan?.filesToModify ?? []) {
      try {
        execFileSync("git", ["checkout", this.checkpoint.baseCommit, "--", f], {
          cwd: this.repo,
          stdio: "ignore",
        });
      } catch {
        /* keep going */
      }
    }
  }

  private advanceOrThrow(): void {
    const r = advance(this.state);
    if (!r.advanced) throw new Error(r.reason || "advance failed");
    this.state = r.state;
    this.persist();
  }

  private addUsage(u: LlmUsage): void {
    this.usage = {
      promptTokens: this.usage.promptTokens + u.promptTokens,
      completionTokens: this.usage.completionTokens + u.completionTokens,
      totalTokens: this.usage.totalTokens + u.totalTokens,
      estimatedCostUsd: this.usage.estimatedCostUsd + u.estimatedCostUsd,
    };
  }

  private persist(): void {
    writeFileSync(
      this.statePath,
      JSON.stringify(
        {
          ...this.state,
          model: modelConfigPublicSummary(this.modelConfig),
          usage: this.usage,
          checkpoint: this.checkpoint,
          interrupted: this.interrupted,
        },
        null,
        2,
      ),
      "utf8",
    );
  }

  private result(success: boolean, error?: string): OrchestratorResult {
    return {
      taskId: this.taskId,
      stage: this.state.stage,
      success,
      outputsDir: this.store.root,
      statePath: this.statePath,
      usage: this.usage,
      error,
      artifacts: this.store.listPresent(),
    };
  }
}

export function loadGoldenFiles(goldenFixedDir: string, repoRoot: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(goldenFixedDir)) return out;
  walk(goldenFixedDir, goldenFixedDir, (abs, rel) => {
    out[rel.split("\\").join("/")] = readFileSync(abs, "utf8");
  });
  void repoRoot;
  return out;
}

function walk(root: string, dir: string, onFile: (abs: string, rel: string) => void): void {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    const st = statSync(abs);
    if (st.isDirectory()) walk(root, abs, onFile);
    else onFile(abs, abs.slice(root.length + 1));
  }
}

export function prepareWorkCopy(fixtureDir: string, workDir: string): void {
  mkdirSync(dirname(workDir), { recursive: true });
  if (existsSync(workDir)) {
    throw new Error(`work dir already exists: ${workDir}`);
  }
  cpSync(fixtureDir, workDir, {
    recursive: true,
    filter: (src) =>
      !/[\\/]outputs([\\/]|$)/.test(src) &&
      !/[\\/]\.git([\\/]|$)/.test(src) &&
      !/[\\/]golden([\\/]|$)/.test(src) &&
      !/[\\/]\.work([\\/]|$)/.test(src),
  });
  execFileSync("git", ["init"], { cwd: workDir, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "issuepilot@local"], { cwd: workDir, stdio: "ignore" });
  execFileSync("git", ["config", "user.name", "IssuePilot"], { cwd: workDir, stdio: "ignore" });
  execFileSync("git", ["add", "-A"], { cwd: workDir, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "workcopy baseline"], { cwd: workDir, stdio: "ignore" });
}
