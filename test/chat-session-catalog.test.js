import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SessionCatalog } from "../dist/chat/session-catalog.js";

test("session errors stay on the session that failed", () => {
  const dir = mkdtempSync(join(tmpdir(), "issuepilot-sessions-"));
  const catalog = new SessionCatalog(dir);
  const first = catalog.add({
    id: "session-a",
    title: "新对话",
    file: "a.jsonl",
    createdAt: "2026-10-20T00:00:00.000Z",
    updatedAt: "2026-10-20T00:00:00.000Z",
  });
  const second = catalog.add({
    id: "session-b",
    title: "新对话",
    file: "b.jsonl",
    createdAt: "2026-10-20T00:00:01.000Z",
    updatedAt: "2026-10-20T00:00:01.000Z",
  });

  catalog.setError(second.id, "模型请求失败");
  catalog.update(first.id, { title: "北窗口令" });

  const saved = JSON.parse(readFileSync(join(dir, "index.json"), "utf8"));
  assert.equal(saved.sessions.find((item) => item.id === first.id).lastError, undefined);
  assert.equal(saved.sessions.find((item) => item.id === second.id).lastError, "模型请求失败");
  assert.equal(saved.sessions.find((item) => item.id === second.id).title, "新对话");
  assert.equal(JSON.stringify(saved).includes("北窗"), true);
  assert.equal(saved.sessions.every((item) => item.messages === undefined), true);
});
