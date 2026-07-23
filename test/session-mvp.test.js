import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, rmSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { resolveModelConfig, ModelConfigError } from "../dist/session/model-config.js";
import { validateRepairPlan, createLlmAdapter, MockLlmAdapter } from "../dist/session/llm-adapter.js";
import {
  IssueOrchestrator,
  loadGoldenFiles,
  prepareWorkCopy,
} from "../dist/session/issue-orchestrator.js";
import { DockerExecutor } from "../dist/docker/executor.js";
import { DEFAULT_DOCKER_POLICY } from "../dist/docker/policy.js";
import { ApprovalService } from "../dist/security/approval.js";
import { redactSummary } from "../dist/trace/run-recorder.js";
import { authorizeToolCall, createRuntimeState, callKey, DEFAULT_WORKFLOW_LIMITS } from "../dist/workflow/runtime-control.js";
import { assessToolCall } from "../dist/security/assess-risk.js";

const ROOT = resolve("e:/AgentProject/pi_project/agent-projects/mlpilot");
const FIX = join(ROOT, "fixtures/issues");

function mockExecutor(handler) {
  return new DockerExecutor({
    cli: {
      async run(args) {
        return handler(args);
      },
      async killContainer() {
        return true;
      },
      async removeContainer() {
        return true;
      },
    },
    skipAvailabilityCheck: true,
    skipImageCheck: true,
    outputsRoot: join(ROOT, "outputs"),
    policy: DEFAULT_DOCKER_POLICY,
  });
}

describe("skills discovery", () => {
  it("three skills exist with frontmatter and forbidden rules", () => {
    for (const name of ["issue-analysis", "safe-code-repair", "patch-validation-review"]) {
      const p = join(ROOT, ".pi/skills", name, "SKILL.md");
      assert.equal(existsSync(p), true, p);
      const text = readFileSync(p, "utf8");
      assert.match(text, /^---[\s\S]*name:\s/m);
      assert.match(text, /Forbidden|禁止|Never|must not/i);
    }
  });
});

describe("model configuration", () => {
  it("mock provider does not require API key", () => {
    const cfg = resolveModelConfig({ provider: "mock", requireLiveKey: false });
    assert.equal(cfg.provider, "mock");
    assert.equal(cfg.apiKeyPresent, false);
  });

  it("missing DeepSeek key errors clearly", () => {
    const prev = process.env.DEEPSEEK_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    assert.throws(
      () => resolveModelConfig({ provider: "deepseek", requireLiveKey: true }),
      (e) => e instanceof ModelConfigError && e.code === "MISSING_API_KEY",
    );
    if (prev !== undefined) process.env.DEEPSEEK_API_KEY = prev;
  });

  it("logs must not leak API key patterns via redact", () => {
    const s = redactSummary("Authorization: Bearer sk-abcdefghijklmnopqrstuvwxyz DEEPSEEK_API_KEY=sk-secret");
    assert.doesNotMatch(s, /sk-abcdef/);
    assert.doesNotMatch(s, /sk-secret/);
  });
});

describe("RepairPlan schema retry", () => {
  it("rejects invalid plan", () => {
    const r = validateRepairPlan({ rootCause: 1 }, "t1");
    assert.equal(r.ok, false);
  });

  it("accepts valid plan from mock adapter", async () => {
    const llm = new MockLlmAdapter("mock");
    const gen = await llm.generateRepairPlan({
      issueSpec: {
        taskId: "t1",
        title: "x",
        issueType: "bug",
        description: "d",
        expectedBehavior: "e",
        actualBehavior: "a",
        reproductionSteps: [],
        acceptanceCriteria: ["tests pass"],
        mentionedFiles: ["src/a.js"],
        mentionedSymbols: [],
        missingInformation: [],
      },
      diagnosis: {
        taskId: "t1",
        summary: "validation",
        rootCauseCandidates: ["validation"],
        evidence: ["e"],
        suspectedFiles: ["src/a.js"],
        suspectedSymbols: [],
        callChain: [],
        confidence: 0.7,
        verificationStatus: "partially_verified",
        missingEvidence: [],
      },
      relatedFiles: ["src/a.js"],
    });
    assert.equal(validateRepairPlan(gen.plan, "t1").ok, true);
  });
});

describe("runtime gates", () => {
  it("blocks tool loop when duplicate threshold exceeded", () => {
    let state = createRuntimeState("understand");
    for (let i = 0; i < DEFAULT_WORKFLOW_LIMITS.duplicateCallThreshold + 1; i++) {
      const r = authorizeToolCall(state, DEFAULT_WORKFLOW_LIMITS, callKey("parse_issue", "same"));
      state = r.state;
      if (i < DEFAULT_WORKFLOW_LIMITS.duplicateCallThreshold) {
        assert.equal(r.decision.allow, true);
      } else {
        assert.equal(r.decision.allow, false);
      }
    }
  });

  it("blocked commands stay blocked", () => {
    const a = assessToolCall({
      toolName: "bash",
      workspaceRoot: ROOT,
      input: { command: "git reset --hard" },
    });
    assert.equal(a.blocked, true);
  });
});

describe("IssueOrchestrator mock session", () => {
  it("dry-run stops before patch and does not modify fixture", async () => {
    const fixture = join(FIX, "node-validation-bug");
    const work = join(FIX, ".work/mvp-dry-" + Date.now());
    prepareWorkCopy(fixture, work);
    const before = readFileSync(join(work, "src/validate.js"), "utf8");
    let calls = 0;
    const executor = mockExecutor(async () => {
      calls += 1;
      return {
        exitCode: 1,
        stdout: "",
        stderr: "FAIL validateUser empty email",
        timedOut: false,
      };
    });
    const orch = new IssueOrchestrator({
      taskId: "mvp-dry-1",
      repositoryPath: work,
      issueBody: readFileSync(join(fixture, "ISSUE.md"), "utf8"),
      provider: "mock",
      dryRun: true,
      allowPatch: false,
      autoApprove: true,
      approvalService: new ApprovalService({ resolver: async () => "approved" }),
      reproduceCommands: [["node", "test/validate.test.js"]],
      expectedFailure: { exitCode: 1, stderrPattern: "FAIL validateUser" },
      dockerExecutor: executor,
      skipDockerAvailabilityCheck: true,
      goldenFiles: loadGoldenFiles(join(fixture, "golden/fixed"), work),
    });
    const r = await orch.run();
    assert.equal(r.success, true);
    assert.notEqual(r.stage, "completed");
    assert.equal(readFileSync(join(work, "src/validate.js"), "utf8"), before);
    assert.ok(calls >= 1);
    try {
      rmSync(work, { recursive: true, force: true });
    } catch {
      /* Windows may lock .git briefly */
    }
  });

  it("without approve cannot patch", async () => {
    const fixture = join(FIX, "node-validation-bug");
    const work = join(FIX, ".work/mvp-noap-" + Date.now());
    prepareWorkCopy(fixture, work);
    const executor = mockExecutor(async () => ({
      exitCode: 1,
      stdout: "",
      stderr: "FAIL validateUser empty email",
      timedOut: false,
    }));
    const orch = new IssueOrchestrator({
      taskId: "mvp-noap-1",
      repositoryPath: work,
      issueBody: readFileSync(join(fixture, "ISSUE.md"), "utf8"),
      provider: "mock",
      allowPatch: true,
      autoApprove: false,
      approvalService: new ApprovalService({
        defaultDenyHigh: true,
        resolver: async () => "rejected",
      }),
      reproduceCommands: [["node", "test/validate.test.js"]],
      expectedFailure: { exitCode: 1, stderrPattern: "FAIL validateUser" },
      dockerExecutor: executor,
      skipDockerAvailabilityCheck: true,
      // force medium risk via custom llm
      llm: {
        provider: "mock",
        model: "mock",
        async generateRepairPlan() {
          return {
            plan: {
              taskId: "mvp-noap-1",
              rootCause: "validation",
              evidence: ["e"],
              filesToModify: ["src/validate.js"],
              plannedChanges: [{ file: "src/validate.js", description: "fix", reason: "bug" }],
              validationCommands: ["node test"],
              acceptanceCriteria: ["Empty email rejected"],
              rollbackStrategy: "checkpoint",
              riskLevel: "high",
              requiresApproval: true,
            },
            rawText: "{}",
            usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCostUsd: 0 },
            provider: "mock",
            model: "mock",
          };
        },
        async generatePatch() {
          return {
            files: {},
            usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCostUsd: 0 },
            provider: "mock",
            model: "mock",
          };
        },
      },
    });
    const r = await orch.run();
    assert.equal(r.success, false);
    assert.match(String(r.error), /rejected/i);
    try {
      rmSync(work, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("full mock loop with golden patch reaches completed", async () => {
    const fixture = join(FIX, "node-validation-bug");
    const work = join(FIX, ".work/mvp-full-" + Date.now());
    prepareWorkCopy(fixture, work);
    let phase = 0;
    const executor = mockExecutor(async () => {
      phase += 1;
      // first call(s): reproduce fail; after patch: pass
      const patched = readFileSync(join(work, "src/validate.js"), "utf8").includes("trim()");
      if (!patched) {
        return {
          exitCode: 1,
          stdout: "",
          stderr: "FAIL validateUser empty email",
          timedOut: false,
        };
      }
      return { exitCode: 0, stdout: "PASS validateUser Empty email rejected", stderr: "", timedOut: false };
    });
    const orch = new IssueOrchestrator({
      taskId: "mvp-full-1",
      repositoryPath: work,
      issueBody: readFileSync(join(fixture, "ISSUE.md"), "utf8"),
      provider: "mock",
      allowPatch: true,
      autoApprove: true,
      approvalService: new ApprovalService({ resolver: async () => "approved" }),
      reproduceCommands: [["node", "test/validate.test.js"]],
      expectedFailure: { exitCode: 1, stderrPattern: "FAIL validateUser" },
      testCommands: [["node", "test/validate.test.js"]],
      dockerExecutor: executor,
      skipDockerAvailabilityCheck: true,
      goldenFiles: loadGoldenFiles(join(fixture, "golden/fixed"), work),
    });
    const r = await orch.run();
    assert.equal(r.success, true, r.error);
    assert.equal(r.stage, "completed");
    assert.ok(existsSync(join(work, "outputs", r.taskId, "pr_summary.md")));
    assert.ok(existsSync(join(work, "outputs", r.taskId, "run_trace.jsonl")));
    assert.ok(readFileSync(join(work, "src/validate.js"), "utf8").includes("trim()"));
    // original fixture untouched
    assert.ok(!readFileSync(join(fixture, "src/validate.js"), "utf8").includes('trim()'));
    try {
      rmSync(work, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("interrupt preserves state", async () => {
    const fixture = join(FIX, "safe-clean-project");
    const work = join(FIX, ".work/mvp-int-" + Date.now());
    prepareWorkCopy(fixture, work);
    const orch = new IssueOrchestrator({
      taskId: "mvp-int-1",
      repositoryPath: work,
      issueBody: readFileSync(join(fixture, "ISSUE.md"), "utf8"),
      provider: "mock",
      dryRun: true,
      approvalService: new ApprovalService({ resolver: async () => "approved" }),
      reproduceCommands: [["node", "test/hello.test.js"]],
      expectedFailure: { exitCode: 1 },
      dockerExecutor: mockExecutor(async () => ({
        exitCode: 0,
        stdout: "PASS",
        stderr: "",
        timedOut: false,
      })),
      skipDockerAvailabilityCheck: true,
    });
    orch.interrupt("test-interrupt");
    // After interrupt flag, run should fail early on gate
    const r = await orch.run();
    // interrupt is checked during stages; if set before run, first gate fails
    assert.equal(r.success, false);
    assert.ok(existsSync(r.statePath));
    try {
      rmSync(work, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });
});

describe("createLlmAdapter", () => {
  it("mock adapter factory works", () => {
    const a = createLlmAdapter({ provider: "mock", model: "m", apiKeyPresent: false });
    assert.equal(a.provider, "mock");
  });
});
