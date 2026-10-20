import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Metadata only. Model context lives in the session file named by `file`. */
export interface SessionMeta {
  id: string;
  title: string;
  file: string;
  createdAt: string;
  updatedAt: string;
  lastError?: string;
}

const ID_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;

export const DEFAULT_SESSION_TITLE = "新对话";
const TITLE_LIMIT = 24;

export function isSessionId(value: string): boolean {
  return ID_PATTERN.test(value) && !value.includes("..");
}

/** Display title only. Does not change the stored user message. */
export function sessionTitleFromFirstMessage(text: string): string {
  const line = text
    .split(/\r?\n/)
    .map((part) => part.trim())
    .find(Boolean) ?? "";
  const compact = line.replace(/\s+/g, " ").trim();
  if (!compact) return DEFAULT_SESSION_TITLE;
  if (compact.length <= TITLE_LIMIT) return compact;
  return `${compact.slice(0, TITLE_LIMIT - 1)}…`;
}

export function selectSessionAfterDelete(
  viewingId: string | null,
  deletedId: string,
  remainingIds: string[],
): { nextId: string | null; createNew: boolean } {
  if (viewingId && viewingId !== deletedId) {
    return { nextId: viewingId, createNew: false };
  }
  if (remainingIds.length > 0) return { nextId: remainingIds[0], createNew: false };
  return { nextId: null, createNew: true };
}

export class SessionCatalog {
  constructor(private readonly dir: string) {}

  list(): SessionMeta[] {
    return this.read()
      .slice()
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
  }

  get(id: string): SessionMeta | undefined {
    if (!isSessionId(id)) return undefined;
    return this.read().find((session) => session.id === id);
  }

  add(session: SessionMeta): SessionMeta {
    const sessions = this.read().filter((item) => item.id !== session.id);
    sessions.push(session);
    this.write(sessions);
    return session;
  }

  update(id: string, patch: Partial<Pick<SessionMeta, "title" | "file" | "updatedAt" | "lastError">>): SessionMeta | undefined {
    const sessions = this.read();
    const index = sessions.findIndex((session) => session.id === id);
    if (index < 0) return undefined;
    const current = sessions[index];
    const next: SessionMeta = {
      ...current,
      ...patch,
      id: current.id,
      createdAt: current.createdAt,
      updatedAt: patch.updatedAt ?? new Date().toISOString(),
    };
    if (patch.lastError === undefined && !Object.prototype.hasOwnProperty.call(patch, "lastError")) {
      next.lastError = current.lastError;
    }
    sessions[index] = next;
    this.write(sessions);
    return next;
  }

  setError(id: string, error: string): SessionMeta | undefined {
    return this.update(id, { lastError: error });
  }

  remove(id: string): SessionMeta | undefined {
    if (!isSessionId(id)) return undefined;
    const sessions = this.read();
    const index = sessions.findIndex((session) => session.id === id);
    if (index < 0) return undefined;
    const [removed] = sessions.splice(index, 1);
    this.write(sessions);
    return removed;
  }

  clearError(id: string): SessionMeta | undefined {
    const sessions = this.read();
    const index = sessions.findIndex((session) => session.id === id);
    if (index < 0) return undefined;
    const next: SessionMeta = { ...sessions[index], updatedAt: new Date().toISOString() };
    delete next.lastError;
    sessions[index] = next;
    this.write(sessions);
    return next;
  }

  private read(): SessionMeta[] {
    const path = this.indexPath();
    if (!existsSync(path)) return [];
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { sessions?: SessionMeta[] };
    return Array.isArray(parsed.sessions) ? parsed.sessions : [];
  }

  private write(sessions: SessionMeta[]): void {
    mkdirSync(this.dir, { recursive: true });
    const path = this.indexPath();
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify({ sessions }, null, 2));
    renameSync(tmp, path);
  }

  private indexPath(): string {
    return join(this.dir, "index.json");
  }
}
