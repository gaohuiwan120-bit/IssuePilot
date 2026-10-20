import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  DEFAULT_SESSION_TITLE,
  selectSessionAfterDelete,
  SessionCatalog,
  sessionTitleFromFirstMessage,
} from "../dist/chat/session-catalog.js";
import { forgetSession } from "../dist/chat/session-delete.js";

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "issuepilot-delete-"));
  writeFileSync(join(dir, "a.jsonl"), "session-a\n");
  writeFileSync(join(dir, "b.jsonl"), "session-b\n");
  writeFileSync(join(dir, "index.json"), "{}\n");
  const catalog = new SessionCatalog(dir);
  catalog.add({
    id: "session-a",
    title: DEFAULT_SESSION_TITLE,
    file: "a.jsonl",
    createdAt: "2026-10-20T00:00:00.000Z",
    updatedAt: "2026-10-20T00:00:02.000Z",
  });
  catalog.add({
    id: "session-b",
    title: "已有标题",
    file: "b.jsonl",
    createdAt: "2026-10-20T00:00:00.000Z",
    updatedAt: "2026-10-20T00:00:01.000Z",
  });
  return { dir, catalog };
}

test("deleting the current session leaves the other session file and selects it", () => {
  const { dir, catalog } = fixture();
  const result = forgetSession(catalog, dir, "session-a", null);
  assert.equal(result.status, 200);
  assert.equal(existsSync(join(dir, "a.jsonl")), false);
  assert.equal(readFileSync(join(dir, "b.jsonl"), "utf8"), "session-b\n");
  assert.equal(existsSync(join(dir, "index.json")), true);
  const remaining = catalog.list();
  assert.deepEqual(remaining.map((item) => item.id), ["session-b"]);
  const choice = selectSessionAfterDelete("session-a", "session-a", remaining.map((item) => item.id));
  assert.deepEqual(choice, { nextId: "session-b", createNew: false });
});

test("deleting a non-current session keeps the current session selected", () => {
  const { dir, catalog } = fixture();
  const before = readFileSync(join(dir, "a.jsonl"), "utf8");
  const result = forgetSession(catalog, dir, "session-b", null);
  assert.equal(result.status, 200);
  assert.equal(readFileSync(join(dir, "a.jsonl"), "utf8"), before);
  assert.equal(existsSync(join(dir, "b.jsonl")), false);
  const choice = selectSessionAfterDelete("session-a", "session-b", catalog.list().map((item) => item.id));
  assert.deepEqual(choice, { nextId: "session-a", createNew: false });
  assert.equal(catalog.get("session-a").title, DEFAULT_SESSION_TITLE);
});

test("deleting the last session asks for a new empty session", () => {
  const { dir, catalog } = fixture();
  assert.equal(forgetSession(catalog, dir, "session-b", null).status, 200);
  assert.equal(forgetSession(catalog, dir, "session-a", null).status, 200);
  assert.equal(catalog.list().length, 0);
  assert.equal(existsSync(join(dir, "a.jsonl")), false);
  assert.equal(existsSync(join(dir, "b.jsonl")), false);
  assert.equal(existsSync(join(dir, "index.json")), true);
  const choice = selectSessionAfterDelete("session-a", "session-a", []);
  assert.deepEqual(choice, { nextId: null, createNew: true });
});

test("a failed file delete does not change the catalog or the other file", () => {
  const { dir, catalog } = fixture();
  const before = catalog.list();
  const result = forgetSession(catalog, dir, "session-a", null, {
    existsSync: () => true,
    unlinkSync: () => {
      throw new Error("busy");
    },
  });
  assert.equal(result.status, 500);
  assert.match(result.error, /busy/);
  assert.equal(existsSync(join(dir, "a.jsonl")), true);
  assert.equal(existsSync(join(dir, "b.jsonl")), true);
  assert.deepEqual(catalog.list().map((item) => item.id), before.map((item) => item.id));
});

test("an in-flight session is not deleted", () => {
  const { dir, catalog } = fixture();
  let unlinked = false;
  const result = forgetSession(catalog, dir, "session-a", "session-a", {
    existsSync: () => true,
    unlinkSync: () => {
      unlinked = true;
    },
  });
  assert.equal(result.status, 409);
  assert.equal(unlinked, false);
  assert.equal(existsSync(join(dir, "a.jsonl")), true);
  assert.equal(catalog.get("session-a").file, "a.jsonl");
  assert.equal(catalog.get("session-b").file, "b.jsonl");
});

test("a missing session file is removed from the catalog without touching other files", () => {
  const { dir, catalog } = fixture();
  const result = forgetSession(catalog, dir, "session-a", null, {
    existsSync: () => false,
    unlinkSync: () => {
      throw new Error("should not unlink");
    },
  });
  assert.equal(result.status, 200);
  assert.equal(catalog.get("session-a"), undefined);
  assert.equal(readFileSync(join(dir, "b.jsonl"), "utf8"), "session-b\n");
});

test("an unsafe file name cannot delete the index or another session", () => {
  const { dir, catalog } = fixture();
  catalog.add({
    id: "session-c",
    title: "坏路径",
    file: "index.json",
    createdAt: "2026-10-20T00:00:03.000Z",
    updatedAt: "2026-10-20T00:00:03.000Z",
  });
  const result = forgetSession(catalog, dir, "session-c", null);
  assert.equal(result.status, 400);
  assert.equal(existsSync(join(dir, "index.json")), true);
  assert.equal(existsSync(join(dir, "a.jsonl")), true);
  assert.equal(catalog.get("session-a").file, "a.jsonl");
  assert.equal(catalog.get("session-c").file, "index.json");
});

test("deleted sessions stay gone after a new catalog reads the same directory", () => {
  const { dir, catalog } = fixture();
  assert.equal(forgetSession(catalog, dir, "session-b", null).status, 200);
  const reloaded = new SessionCatalog(dir);
  assert.equal(reloaded.get("session-b"), undefined);
  assert.equal(reloaded.get("session-a").file, "a.jsonl");
  assert.equal(existsSync(join(dir, "b.jsonl")), false);
  assert.equal(existsSync(join(dir, "a.jsonl")), true);
});

test("titles are shortened for display and survive a catalog reload", () => {
  const { dir, catalog } = fixture();
  const original = "请解释下面这段很长的代码在做什么，并指出关键路径。\n第二行不应进入标题";
  const title = sessionTitleFromFirstMessage(original);
  assert.equal(original.startsWith("请解释下面这段很长的代码"), true);
  assert.equal(title.length <= 24, true);
  assert.equal(title.endsWith("…"), true);
  assert.equal(title.includes("第二行"), false);
  catalog.update("session-a", { title, updatedAt: "2026-10-20T00:00:04.000Z" });
  assert.equal(readFileSync(join(dir, "a.jsonl"), "utf8"), "session-a\n");
  const reloaded = new SessionCatalog(dir);
  assert.equal(reloaded.list()[0].id, "session-a");
  assert.equal(reloaded.list()[0].title, title);
  assert.equal(reloaded.get("session-b").title, "已有标题");
  assert.equal(sessionTitleFromFirstMessage("   "), DEFAULT_SESSION_TITLE);
});
