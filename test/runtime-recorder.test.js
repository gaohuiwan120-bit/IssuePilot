import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RunRecorder, redactSummary } from "../dist/trace/run-recorder.js";
import {
  authorizeToolCall,
  callKey,
  createRuntimeState,
  enterStage,
  markInterrupted,
  recordRetry,
  DEFAULT_WORKFLOW_LIMITS,
} from "../dist/workflow/runtime-control.js";

describe("RunRecorder", () => {
  const dirs = [];
  after(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });

  it("appends JSONL and summarizes", () => {
    const dir = mkdtempSync(join(tmpdir(), "issuepilot-trace-"));
    dirs.push(dir);
    const rec = new RunRecorder(dir, "task-trace");
    rec.append({
      stage: "understand",
      eventType: "tool_call",
      toolName: "read",
      success: true,
      summary: "ok",
      riskLevel: "low",
    });
    rec.append({
      stage: "understand",
      eventType: "blocked",
      toolName: "bash",
      success: false,
      summary: "blocked",
      riskLevel: "blocked",
    });
    rec.append({
      stage: "approve",
      eventType: "approval",
      success: true,
      summary: "approved",
      approvalId: "a1",
    });
    const summary = rec.summarize();
    assert.equal(summary.totalEvents, 3);
    assert.equal(summary.blockedOps, 1);
    assert.equal(summary.approvals, 1);
    assert.ok(existsSync(rec.tracePath));
    const line = readFileSync(rec.tracePath, "utf8").trim().split("\n")[0];
    assert.ok(JSON.parse(line).eventId);
  });

  it("redacts obvious secrets from summaries", () => {
    const s = redactSummary("Authorization: Bearer sk-abcdefghijklmnopqrstuvwxyz");
    assert.match(s, /REDACTED/);
    assert.doesNotMatch(s, /sk-abcdef/);
  });

  it("writes large details to side files", () => {
    const dir = mkdtempSync(join(tmpdir(), "issuepilot-trace-"));
    dirs.push(dir);
    const rec = new RunRecorder(dir, "task-detail");
    const p = rec.writeDetail("stdout", "x".repeat(5000));
    assert.ok(existsSync(p));
  });
});

describe("Workflow runtime control", () => {
  it("enforces duplicate call threshold", () => {
    let state = createRuntimeState("inspect");
    const limits = { ...DEFAULT_WORKFLOW_LIMITS, duplicateCallThreshold: 2 };
    const key = callKey("bash", "npm test");
    for (let i = 0; i < 2; i++) {
      const r = authorizeToolCall(state, limits, key);
      assert.equal(r.decision.allow, true);
      state = r.state;
    }
    const blocked = authorizeToolCall(state, limits, key);
    assert.equal(blocked.decision.allow, false);
    assert.match(blocked.decision.reason ?? "", /duplicate/i);
  });

  it("enforces max tool calls per stage", () => {
    let state = createRuntimeState("patch");
    const limits = { ...DEFAULT_WORKFLOW_LIMITS, maxToolCallsPerStage: 2, duplicateCallThreshold: 100 };
    state = authorizeToolCall(state, limits, callKey("a", "1")).state;
    state = authorizeToolCall(state, limits, callKey("a", "2")).state;
    const r = authorizeToolCall(state, limits, callKey("a", "3"));
    assert.equal(r.decision.allow, false);
  });

  it("handles interrupt and retry limits", () => {
    let state = markInterrupted(createRuntimeState("test"), "stop");
    const denied = authorizeToolCall(state, DEFAULT_WORKFLOW_LIMITS, "x");
    assert.equal(denied.decision.allow, false);
    assert.equal(denied.decision.failureKind, "interrupted");

    state = createRuntimeState("test");
    const limits = { ...DEFAULT_WORKFLOW_LIMITS, maxRetriesPerStage: 1 };
    let r = recordRetry(state, limits);
    assert.equal(r.decision.allow, true);
    r = recordRetry(r.state, limits);
    assert.equal(r.decision.allow, false);
    assert.equal(r.decision.failureKind, "fatal");
  });

  it("resets per-stage counters on enterStage", () => {
    let state = createRuntimeState("patch");
    const limits = { ...DEFAULT_WORKFLOW_LIMITS, maxToolCallsPerStage: 1, duplicateCallThreshold: 100 };
    state = authorizeToolCall(state, limits, "k1").state;
    assert.equal(authorizeToolCall(state, limits, "k2").decision.allow, false);
    state = enterStage(state, "test");
    assert.equal(authorizeToolCall(state, limits, "k3").decision.allow, true);
  });
});
