import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { assessToolCall, operationHash } from "../dist/security/assess-risk.js";
import { ApprovalService } from "../dist/security/approval.js";
import { normalizeCommand } from "../dist/security/normalize.js";

const WS = "e:\\AgentProject\\pi_project\\agent-projects\\mlpilot";

describe("Permission Gate risk assessment", () => {
  it("1. allows low-risk read", () => {
    const a = assessToolCall({
      toolName: "read",
      input: { path: "src/index.ts" },
      workspaceRoot: WS,
    });
    assert.equal(a.level, "low");
    assert.equal(a.blocked, false);
  });

  it("2. classifies source edit as medium", () => {
    const a = assessToolCall({
      toolName: "edit",
      input: { path: "src/foo.ts", newText: "x" },
      workspaceRoot: WS,
    });
    assert.equal(a.level, "medium");
    assert.equal(a.requiresApproval, true);
  });

  it("3. classifies dependency install as high", () => {
    const a = assessToolCall({
      toolName: "bash",
      input: { command: "npm install lodash" },
      workspaceRoot: WS,
    });
    assert.equal(a.level, "high");
    assert.equal(a.requiresApproval, true);
  });

  it("4. blocks git reset --hard", () => {
    const a = assessToolCall({
      toolName: "bash",
      input: { command: "git reset --hard HEAD" },
      workspaceRoot: WS,
    });
    assert.equal(a.blocked, true);
    assert.equal(a.level, "blocked");
  });

  it("5. blocks git clean -fd", () => {
    const a = assessToolCall({
      toolName: "bash",
      input: { command: "git clean -fd" },
      workspaceRoot: WS,
    });
    assert.equal(a.blocked, true);
  });

  it("6. blocks sudo", () => {
    const a = assessToolCall({
      toolName: "bash",
      input: { command: "sudo apt install x" },
      workspaceRoot: WS,
    });
    assert.equal(a.blocked, true);
  });

  it("7. blocks paths outside workspace", () => {
    const a = assessToolCall({
      toolName: "read",
      input: { path: "C:\\Windows\\System32\\drivers\\etc\\hosts" },
      workspaceRoot: WS,
    });
    assert.equal(a.blocked, true);
  });

  it("8. blocks .env and private key reads", () => {
    const env = assessToolCall({
      toolName: "read",
      input: { path: ".env" },
      workspaceRoot: WS,
    });
    assert.equal(env.blocked, true);
    const key = assessToolCall({
      toolName: "read",
      input: { path: "certs/id_rsa" },
      workspaceRoot: WS,
    });
    assert.equal(key.blocked, true);
  });

  it("9. blocks path traversal", () => {
    const a = assessToolCall({
      toolName: "read",
      input: { path: "../pi-upstream/packages/coding-agent/src/x.ts" },
      workspaceRoot: WS,
    });
    assert.equal(a.blocked, true);
  });

  it("10. shell wrappers and spaces cannot bypass reset --hard", () => {
    const variants = [
      "bash -lc 'git   reset   --hard'",
      "GIT reset --HARD HEAD~1",
      "sh -c \"git reset --hard\"",
    ];
    for (const command of variants) {
      const a = assessToolCall({
        toolName: "bash",
        input: { command },
        workspaceRoot: WS,
      });
      assert.equal(a.blocked, true, command);
      assert.ok(normalizeCommand(command).includes("git reset --hard") || a.blocked);
    }
  });

  it("11. approval only matches the same operation hash", async () => {
    const svc = new ApprovalService({
      resolver: async () => "approved",
    });
    const assessment = assessToolCall({
      toolName: "edit",
      input: { path: "src/a.ts", newText: "1" },
      workspaceRoot: WS,
    });
    const decided = await svc.requestApproval({
      taskId: "t",
      toolName: "edit",
      assessment,
      input: { path: "src/a.ts", newText: "1" },
    });
    assert.equal(decided.approved, true);

    const other = assessToolCall({
      toolName: "edit",
      input: { path: "src/b.ts", newText: "1" },
      workspaceRoot: WS,
    });
    const mismatch = svc.validateForOperation(
      decided.approvalId,
      "edit",
      other,
      { path: "src/b.ts", newText: "1" },
    );
    assert.equal(mismatch.ok, false);
    assert.match(mismatch.reason ?? "", /match/i);

    const same = svc.validateForOperation(
      decided.approvalId,
      "edit",
      assessment,
      { path: "src/a.ts", newText: "1" },
    );
    assert.equal(same.ok, true);
    assert.notEqual(
      operationHash("edit", assessment, { path: "src/a.ts" }),
      operationHash("edit", other, { path: "src/b.ts" }),
    );
  });

  it("12. expired approval is invalid", async () => {
    let now = Date.parse("2026-01-01T00:00:00.000Z");
    const svc = new ApprovalService({
      resolver: async () => "approved",
      now: () => new Date(now),
    });
    const assessment = assessToolCall({
      toolName: "bash",
      input: { command: "npm run build" },
      workspaceRoot: WS,
    });
    const decided = await svc.requestApproval({
      taskId: "t",
      toolName: "bash",
      assessment,
      input: { command: "npm run build" },
      ttlMs: 1000,
    });
    assert.equal(decided.approved, true);
    now += 60_000;
    const check = svc.validateForOperation(
      decided.approvalId,
      "bash",
      assessment,
      { command: "npm run build" },
    );
    assert.equal(check.ok, false);
    assert.match(check.reason ?? "", /expir/i);
  });
});
