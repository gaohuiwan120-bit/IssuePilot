/**
 * Live DeepSeek E2E — only runs when DEEPSEEK_API_KEY is set.
 * Uses two fixtures (Node + Python). Does not write keys into snapshots.
 */
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { loadDotEnv } from "../dist/config/load-env.js";
import { detectDockerAvailability, imageExistsLocally } from "../dist/docker/availability.js";
import {
  IssueOrchestrator,
  loadGoldenFiles,
  prepareWorkCopy,
} from "../dist/session/issue-orchestrator.js";
import { ApprovalService } from "../dist/security/approval.js";
import { PROJECT_ROOT } from "./helpers/project-root.js";

const ROOT = PROJECT_ROOT;
const FIX = join(ROOT, "fixtures/issues");

let dockerOk = false;
let nodeImage = false;
let pythonImage = false;
let hasKey = false;

before(async () => {
  loadDotEnv(ROOT);
  hasKey = Boolean(process.env.DEEPSEEK_API_KEY?.trim());
  const avail = await detectDockerAvailability();
  dockerOk = avail.available;
  if (dockerOk) {
    nodeImage = await imageExistsLocally("issuepilot-node:local");
    pythonImage = await imageExistsLocally("issuepilot-python:local");
  }
  console.log(
    `[e2e-live] key=${hasKey ? "present" : "missing"} docker=${dockerOk} node=${nodeImage} python=${pythonImage}`,
  );
});

describe("Live DeepSeek E2E (gated)", () => {
  it("Node validation bug closed loop", async (t) => {
    if (!hasKey) {
      t.skip("DEEPSEEK_API_KEY not set — refusing to invent live results");
      return;
    }
    if (!dockerOk || !nodeImage) {
      t.skip("docker/node image unavailable");
      return;
    }
    const fixture = join(FIX, "node-validation-bug");
    const work = join(FIX, `.work/live-node-${Date.now()}`);
    prepareWorkCopy(fixture, work);
    const started = Date.now();
    const orch = new IssueOrchestrator({
      taskId: `live-node-${Date.now()}`,
      repositoryPath: work,
      issueBody: readFileSync(join(fixture, "ISSUE.md"), "utf8"),
      provider: "deepseek",
      allowPatch: true,
      autoApprove: true,
      approvalService: new ApprovalService({ resolver: async () => "approved" }),
      reproduceCommands: [["node", "test/validate.test.js"]],
      expectedFailure: { exitCode: 1, stderrPattern: "FAIL validateUser" },
      testCommands: [["node", "test/validate.test.js"]],
      image: "issuepilot-node:local",
      // Controlled MVP: live model for plan; golden contents for patch apply to avoid unbounded edits
      goldenFiles: loadGoldenFiles(join(fixture, "golden/fixed"), work),
    });
    const r = await orch.run();
    const durationMs = Date.now() - started;
    console.log(
      JSON.stringify({
        case: "node-validation-bug",
        success: r.success,
        stage: r.stage,
        usage: r.usage,
        durationMs,
        error: r.error,
      }),
    );
    assert.equal(r.success, true, r.error);
    assert.equal(r.stage, "completed");
    assert.ok(existsSync(join(r.outputsDir, "run_trace.jsonl")));
    assert.ok(!readFileSync(join(fixture, "src/validate.js"), "utf8").includes("trim()"));
    rmSync(work, { recursive: true, force: true });
  });

  it("Python path bug closed loop", async (t) => {
    if (!hasKey) {
      t.skip("DEEPSEEK_API_KEY not set — refusing to invent live results");
      return;
    }
    if (!dockerOk || !pythonImage) {
      t.skip("docker/python image unavailable");
      return;
    }
    const fixture = join(FIX, "python-path-bug");
    const work = join(FIX, `.work/live-py-${Date.now()}`);
    prepareWorkCopy(fixture, work);
    const started = Date.now();
    const orch = new IssueOrchestrator({
      taskId: `live-py-${Date.now()}`,
      repositoryPath: work,
      issueBody: readFileSync(join(fixture, "ISSUE.md"), "utf8"),
      provider: "deepseek",
      allowPatch: true,
      autoApprove: true,
      approvalService: new ApprovalService({ resolver: async () => "approved" }),
      reproduceCommands: [["python", "tests/run_paths.py"]],
      expectedFailure: { exitCode: 1, stdoutPattern: "FAIL resolve_data_path" },
      testCommands: [["python", "tests/run_paths.py"]],
      image: "issuepilot-python:local",
      goldenFiles: loadGoldenFiles(join(fixture, "golden/fixed"), work),
    });
    const r = await orch.run();
    const durationMs = Date.now() - started;
    console.log(
      JSON.stringify({
        case: "python-path-bug",
        success: r.success,
        stage: r.stage,
        usage: r.usage,
        durationMs,
        error: r.error,
      }),
    );
    assert.equal(r.success, true, r.error);
    assert.equal(r.stage, "completed");
    rmSync(work, { recursive: true, force: true });
  });
});
