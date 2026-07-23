import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  createInitialState,
  advance,
  attemptEnter,
  markArtifact,
  markReproduction,
  grantApproval,
  setPlanRisk,
  markCheckpointCreated,
  markPatchProduced,
  markValidationExecuted,
  markReviewResult,
  retryFromTest,
} from "../dist/workflow/state-machine.js";
import {
  ArtifactStore,
  ArtifactError,
  assertValidTaskId,
} from "../dist/artifacts/store.js";

function happyPathTo(stage) {
  let s = createInitialState("task-happy");
  const steps = [
    ["issue_spec.json", "inspect"],
    ["repository_inventory.json", "reproduce"],
    ["reproduction.json", "diagnose"],
    ["diagnosis.json", "plan"],
    ["repair_plan.json", "approve"],
  ];

  for (const [art, _dest] of steps) {
    if (art === "reproduction.json") {
      s = markReproduction(s, { reproduced: true });
    } else {
      s = markArtifact(s, art);
    }
    const r = advance(s);
    assert.equal(r.advanced, true, r.reason);
    s = r.state;
  }

  // approve -> checkpoint
  s = setPlanRisk(s, "high");
  s = grantApproval(s, true);
  s = markArtifact(s, "approval.json");
  let r = advance(s);
  assert.equal(r.advanced, true, r.reason);
  s = r.state;
  assert.equal(s.stage, "checkpoint");

  if (stage === "checkpoint") return s;

  s = markCheckpointCreated(s);
  r = advance(s);
  assert.equal(r.advanced, true, r.reason);
  s = r.state;
  assert.equal(s.stage, "patch");
  if (stage === "patch") return s;

  s = markPatchProduced(s);
  r = advance(s);
  assert.equal(r.advanced, true, r.reason);
  s = r.state;
  assert.equal(s.stage, "test");
  if (stage === "test") return s;

  s = markValidationExecuted(s, true);
  r = advance(s);
  assert.equal(r.advanced, true, r.reason);
  s = r.state;
  assert.equal(s.stage, "review");
  if (stage === "review") return s;

  s = markReviewResult(s, true);
  r = advance(s);
  assert.equal(r.advanced, true, r.reason);
  s = r.state;
  assert.equal(s.stage, "report");
  if (stage === "report") return s;

  r = advance(s);
  assert.equal(r.advanced, true, r.reason);
  s = r.state;
  assert.equal(s.stage, "completed");
  return s;
}

describe("IssuePilot state-machine", () => {
  it("1. completes the full happy path", () => {
    const s = happyPathTo("completed");
    assert.equal(s.stage, "completed");
  });

  it("2. blocks inspect without understand artifact (issue_spec)", () => {
    const s = createInitialState("t2");
    const r = attemptEnter(s, "inspect");
    assert.equal(r.advanced, false);
    assert.match(r.reason, /issue_spec/);
  });

  it("3. blocks reproduce without repository_inventory", () => {
    let s = createInitialState("t3");
    s = markArtifact(s, "issue_spec.json");
    s = advance(s).state;
    const r = attemptEnter(s, "reproduce");
    assert.equal(r.advanced, false);
    assert.match(r.reason, /repository_inventory/);
  });

  it("4. blocks diagnose without reproduction.json", () => {
    let s = createInitialState("t4");
    s = markArtifact(s, "issue_spec.json");
    s = advance(s).state;
    s = markArtifact(s, "repository_inventory.json");
    s = advance(s).state;
    assert.equal(s.stage, "reproduce");
    const r = advance(s);
    assert.equal(r.advanced, false);
    assert.match(r.reason, /reproduction/);
  });

  it("5. allows diagnose when unreproducible with explicit exception", () => {
    let s = createInitialState("t5");
    s = markArtifact(s, "issue_spec.json");
    s = advance(s).state;
    s = markArtifact(s, "repository_inventory.json");
    s = advance(s).state;
    s = markReproduction(s, {
      reproduced: false,
      unreproducibleException: true,
    });
    const r = advance(s);
    assert.equal(r.advanced, true, r.reason);
    assert.equal(r.state.stage, "diagnose");
    assert.equal(r.state.unreproducibleException, true);
  });

  it("6. blocks plan without diagnosis.json", () => {
    let s = createInitialState("t6");
    s = markArtifact(s, "issue_spec.json");
    s = advance(s).state;
    s = markArtifact(s, "repository_inventory.json");
    s = advance(s).state;
    s = markReproduction(s, { reproduced: true });
    s = advance(s).state;
    assert.equal(s.stage, "diagnose");
    const r = advance(s);
    assert.equal(r.advanced, false);
    assert.match(r.reason, /diagnosis/);
  });

  it("7. blocks checkpoint when high-risk plan is not approved", () => {
    let s = createInitialState("t7");
    for (const art of [
      "issue_spec.json",
      "repository_inventory.json",
      "reproduction.json",
      "diagnosis.json",
      "repair_plan.json",
    ]) {
      if (art === "reproduction.json") s = markReproduction(s, { reproduced: true });
      else s = markArtifact(s, art);
      const r = advance(s);
      assert.equal(r.advanced, true, `${art}: ${r.reason}`);
      s = r.state;
    }
    assert.equal(s.stage, "approve");
    s = setPlanRisk(s, "high");
    s = grantApproval(s, false);
    const r = advance(s);
    assert.equal(r.advanced, false);
    assert.match(r.reason, /Approval|approval/i);
  });

  it("8. blocks patch without checkpoint", () => {
    const s = happyPathTo("checkpoint");
    const r = advance(s);
    assert.equal(r.advanced, false);
    assert.match(r.reason, /checkpoint/i);
  });

  it("9. blocks test without patch", () => {
    let s = happyPathTo("patch");
    const r = advance(s);
    assert.equal(r.advanced, false);
    assert.match(r.reason, /patch/i);
  });

  it("10. test failure retry returns to diagnose", () => {
    let s = happyPathTo("test");
    s = markValidationExecuted(s, false);
    const r = retryFromTest(s);
    assert.equal(r.advanced, true, r.reason);
    assert.equal(r.state.stage, "diagnose");
    assert.equal(r.state.retryCount, 1);
  });

  it("11. max retries moves to rolled_back", () => {
    let s = happyPathTo("test");
    s = { ...s, retryCount: 3 };
    const r = retryFromTest(s);
    assert.equal(r.advanced, false);
    assert.equal(r.state.stage, "rolled_back");
  });

  it("12. review failure cannot enter completed", () => {
    let s = happyPathTo("review");
    s = markReviewResult(s, false);
    s = advance(s).state;
    assert.equal(s.stage, "report");
    const r = advance(s);
    assert.equal(r.advanced, false);
    assert.match(r.reason, /review/i);
  });

  it("13. low-risk plan can advance approve without explicit grant if approval artifact present", () => {
    let s = createInitialState("t13");
    for (const art of [
      "issue_spec.json",
      "repository_inventory.json",
      "reproduction.json",
      "diagnosis.json",
      "repair_plan.json",
    ]) {
      if (art === "reproduction.json") s = markReproduction(s, { reproduced: true });
      else s = markArtifact(s, art);
      s = advance(s).state;
    }
    s = setPlanRisk(s, "low");
    s = markArtifact(s, "approval.json");
    const r = advance(s);
    assert.equal(r.advanced, true, r.reason);
    assert.equal(r.state.stage, "checkpoint");
  });
});

describe("IssuePilot artifacts", () => {
  let dir;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), "issuepilot-art-"));
  });

  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("rejects invalid taskId / path traversal", () => {
    assert.throws(() => assertValidTaskId("../x"), /invalid|traversal/i);
    assert.throws(() => assertValidTaskId("a/b"), /invalid|traversal/i);
    assert.throws(() => new ArtifactStore(dir, ".."), /invalid|traversal/i);
  });

  it("writes JSON atomically and reads optional missing as undefined", () => {
    const store = new ArtifactStore(dir, "task-1");
    store.writeJson("issue_spec.json", {
      taskId: "task-1",
      title: "t",
      issueType: "bug",
      description: "d",
      expectedBehavior: null,
      actualBehavior: null,
      reproductionSteps: [],
      acceptanceCriteria: [],
      mentionedFiles: [],
      mentionedSymbols: [],
      missingInformation: [],
    });
    assert.equal(store.has("issue_spec.json"), true);
    assert.equal(store.readJson("review.json"), undefined);
    assert.throws(() => store.requireJson("review.json"), ArtifactError);
    const raw = readFileSync(store.path("issue_spec.json"), "utf8");
    assert.match(raw, /task-1/);
  });

  it("creates outputs/<task-id> layout", () => {
    const store = new ArtifactStore(dir, "layout-1");
    store.writePrSummary("# PR");
    assert.equal(existsSync(join(dir, "layout-1", "pr_summary.md")), true);
  });
});
