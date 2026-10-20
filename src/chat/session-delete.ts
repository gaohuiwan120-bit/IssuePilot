import { existsSync, unlinkSync } from "node:fs";
import { basename, resolve, sep } from "node:path";
import { SessionCatalog, type SessionMeta } from "./session-catalog.js";

export interface FileOps {
  existsSync(path: string): boolean;
  unlinkSync(path: string): void;
}

const defaultOps: FileOps = { existsSync, unlinkSync };

/** Only a single .jsonl basename inside the session directory is accepted. */
export function resolveOwnedSessionFile(dir: string, file: string): string {
  if (!file || file !== basename(file) || !file.endsWith(".jsonl") || file.includes("..")) {
    throw new Error("会话文件路径无效");
  }
  const root = resolve(dir);
  const full = resolve(root, file);
  const prefix = root.endsWith(sep) ? root : root + sep;
  if (!full.startsWith(prefix)) {
    throw new Error("会话文件路径无效");
  }
  return full;
}

/**
 * Remove one session from the catalog and delete only its session file.
 * Pi SessionManager has no delete API; this unlinks the one owned .jsonl file.
 */
export function forgetSession(
  catalog: SessionCatalog,
  dir: string,
  id: string,
  inflightId: string | null,
  ops: FileOps = defaultOps,
): { status: number; error?: string; removed?: SessionMeta } {
  if (inflightId === id) {
    return { status: 409, error: "会话正在生成回复，请稍后再删除" };
  }
  const meta = catalog.get(id);
  if (!meta) return { status: 404, error: "会话不存在" };

  let full: string;
  try {
    full = resolveOwnedSessionFile(dir, meta.file);
  } catch (error) {
    return { status: 400, error: error instanceof Error ? error.message : String(error) };
  }

  try {
    if (ops.existsSync(full)) ops.unlinkSync(full);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { status: 500, error: `删除会话文件失败：${message}` };
  }

  const removed = catalog.remove(id);
  if (!removed) return { status: 404, error: "会话不存在" };
  return { status: 200, removed };
}
