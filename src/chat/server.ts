/**
 * Local chat UI. Each conversation has its own id, transcript file, and Pi session.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createIssueAgentSession, getIssueAgentRuntime } from "../session/agent-session-factory.js";
import { ModelConfigError } from "../session/model-config.js";
import { isSessionId, SessionCatalog, sessionTitleFromFirstMessage, type SessionMeta } from "./session-catalog.js";
import { forgetSession } from "./session-delete.js";

const HOST = "127.0.0.1";
const PORT = Number(process.env.ISSUEPILOT_CHAT_PORT || 8787);
const HTML_PATH = join(dirname(fileURLToPath(import.meta.url)), "../../src/chat/public/index.html");
const sessionsDir = join(process.cwd(), ".issuepilot", "chat-sessions");
const catalog = new SessionCatalog(sessionsDir);

interface LoosePart {
  type?: string;
  text?: string;
  name?: string;
}

interface LooseMessage {
  role?: string;
  content?: string | LoosePart[];
  errorMessage?: string;
  stopReason?: string;
  toolName?: string;
  isError?: boolean;
}

interface PublicMessage {
  role: string;
  text: string;
  tools?: string[];
  toolName?: string;
  isError?: boolean;
  stopReason?: string;
  error?: string;
}

type ChatSession = Awaited<ReturnType<typeof createIssueAgentSession>>["session"];

const managers = new Map<string, SessionManager>();
const agents = new Map<string, ChatSession>();
let modelSummary: Record<string, string> | null = null;
let bootError: string | null = null;
let phase: "booting" | "ready" | "error" = "booting";
let inflightSessionId: string | null = null;
let activity = "正在连接 Agent…";

function textFromContent(content: LooseMessage["content"]): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part) => part.type === "text" && part.text)
    .map((part) => part.text)
    .join("\n");
}

function toPublic(message: LooseMessage): PublicMessage | null {
  if (message.role === "user") {
    return { role: "user", text: textFromContent(message.content) };
  }
  if (message.role === "assistant") {
    const parts = Array.isArray(message.content) ? message.content : [];
    const tools = parts.filter((part) => part.type === "toolCall" && part.name).map((part) => part.name as string);
    return {
      role: "assistant",
      text: textFromContent(message.content),
      tools,
      stopReason: message.stopReason,
      error: message.errorMessage,
    };
  }
  if (message.role === "toolResult") {
    const text = textFromContent(message.content);
    return {
      role: "tool",
      toolName: message.toolName,
      text: text.length > 2000 ? `${text.slice(0, 2000)}\n…(已截断)` : text,
      isError: Boolean(message.isError),
    };
  }
  return null;
}

function project(messages: readonly LooseMessage[]): PublicMessage[] {
  return messages.map(toPublic).filter((item): item is PublicMessage => item !== null);
}

function publicMeta(session: SessionMeta) {
  return {
    id: session.id,
    title: session.title,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    hasError: Boolean(session.lastError),
  };
}

function sessionFile(meta: SessionMeta): string {
  return join(sessionsDir, meta.file);
}

function rememberManager(id: string, manager: SessionManager): void {
  if (manager.getSessionId() !== id) {
    throw new Error("会话文件与会话 ID 不一致");
  }
  managers.set(id, manager);
}

function createChatSession(): SessionMeta {
  const manager = SessionManager.create(process.cwd(), sessionsDir);
  const file = manager.getSessionFile();
  const id = manager.getSessionId();
  if (!file || !id) throw new Error("无法创建会话文件");
  const now = new Date().toISOString();
  const meta = catalog.add({
    id,
    title: "新对话",
    file: basename(file),
    createdAt: now,
    updatedAt: now,
  });
  rememberManager(id, manager);
  return meta;
}

function managerFor(meta: SessionMeta): SessionManager {
  const cached = managers.get(meta.id);
  if (cached) return cached;
  const full = sessionFile(meta);
  if (existsSync(full)) {
    const opened = SessionManager.open(full, sessionsDir, process.cwd());
    rememberManager(meta.id, opened);
    return opened;
  }
  const created = SessionManager.create(process.cwd(), sessionsDir, { id: meta.id });
  const file = created.getSessionFile();
  if (!file) throw new Error("无法恢复空会话");
  catalog.update(meta.id, { file: basename(file) });
  rememberManager(meta.id, created);
  return created;
}

function messagesFor(id: string): PublicMessage[] {
  const live = agents.get(id);
  if (live) return project(live.messages as LooseMessage[]);
  const cached = managers.get(id);
  if (cached) return project(cached.buildSessionContext().messages as LooseMessage[]);
  const meta = catalog.get(id);
  if (!meta || !existsSync(sessionFile(meta))) return [];
  const opened = SessionManager.open(sessionFile(meta), sessionsDir, process.cwd());
  if (opened.getSessionId() !== id) return [];
  return project(opened.buildSessionContext().messages as LooseMessage[]);
}

async function ensureAgent(id: string): Promise<ChatSession> {
  const live = agents.get(id);
  if (live) return live;
  const meta = catalog.get(id);
  if (!meta) throw new Error("会话不存在");
  const manager = managerFor(meta);
  const created = await createIssueAgentSession({
    cwd: process.cwd(),
    provider: "deepseek",
    sessionManager: manager,
  });
  created.session.subscribe((event) => {
    if (inflightSessionId !== id) return;
    if (event.type === "turn_start") activity = "Agent 正在思考…";
    else if (event.type === "tool_execution_start") activity = `正在调用工具 ${event.toolName}`;
    else if (event.type === "message_update") activity = "正在生成回复…";
    else if (event.type === "agent_end" || event.type === "agent_settled") {
      activity = inflightSessionId ? "正在整理结果…" : "空闲";
    }
  });
  agents.set(id, created.session);
  return created.session;
}

function dropRuntime(id: string): void {
  const agent = agents.get(id);
  agents.delete(id);
  managers.delete(id);
  try {
    agent?.dispose();
  } catch {
    // The session file is already removed. Listener cleanup must not restore it.
  }
}

function statusBody() {
  return {
    phase,
    busy: inflightSessionId !== null,
    busySessionId: inflightSessionId,
    activity,
    model: modelSummary,
    error: bootError,
    mode: "pi-agent-chat",
  };
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(data),
  });
  res.end(data);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 64_000) {
        reject(new Error("请求过大"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function handleChat(sessionId: string, text: string) {
  const meta = catalog.get(sessionId);
  if (!meta) return { ok: false, status: 404, sessionId, error: "会话不存在", messages: [] };
  if (inflightSessionId) {
    return { ok: false, status: 409, sessionId, error: "Agent 正在处理上一条消息", messages: [] };
  }
  inflightSessionId = sessionId;
  activity = "正在生成回复…";
  try {
    const session = await ensureAgent(sessionId);
    const before = session.messages.length;
    await session.prompt(text);
    const added = project((session.messages as LooseMessage[]).slice(before));
    const failed = added.find((item) => item.role === "assistant" && item.error);
    const title = meta.title === "新对话" ? sessionTitleFromFirstMessage(text) : meta.title;
    catalog.update(sessionId, { title, updatedAt: new Date().toISOString() });
    if (failed?.error) catalog.setError(sessionId, failed.error);
    else catalog.clearError(sessionId);
    activity = failed ? "模型请求失败" : "空闲";
    return {
      ok: !failed,
      status: failed ? 502 : 200,
      sessionId,
      messages: added,
      error: failed?.error,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    catalog.setError(sessionId, message);
    activity = "请求失败";
    return { ok: false, status: 502, sessionId, error: message, messages: [] };
  } finally {
    inflightSessionId = null;
  }
}

async function boot() {
  try {
    const runtime = await getIssueAgentRuntime({ cwd: process.cwd(), provider: "deepseek" });
    modelSummary = runtime.modelSummary;
    phase = "ready";
    activity = "空闲";
    console.log(
      `Agent ready provider=${modelSummary.provider} model=${modelSummary.model} key=${modelSummary.apiKey}`,
    );
  } catch (error) {
    phase = "error";
    bootError =
      error instanceof ModelConfigError
        ? `${error.code}: ${error.message}`
        : error instanceof Error
          ? error.message
          : String(error);
    activity = "Agent 未就绪";
    console.error(`Agent boot failed: ${bootError}`);
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${HOST}`);
  try {
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      const html = readFileSync(HTML_PATH);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/status") {
      sendJson(res, 200, statusBody());
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/sessions") {
      sendJson(res, 200, { sessions: catalog.list().map(publicMeta) });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/sessions") {
      const session = createChatSession();
      sendJson(res, 201, { session: publicMeta(session) });
      return;
    }
    const sessionMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)$/);
    if (req.method === "DELETE" && sessionMatch) {
      const id = decodeURIComponent(sessionMatch[1]);
      if (!isSessionId(id)) {
        sendJson(res, 400, { ok: false, error: "会话 ID 无效" });
        return;
      }
      const result = forgetSession(catalog, sessionsDir, id, inflightSessionId);
      if (result.status === 200) dropRuntime(id);
      if (result.status !== 200) {
        sendJson(res, result.status, { ok: false, sessionId: id, error: result.error });
        return;
      }
      sendJson(res, 200, {
        ok: true,
        deletedId: id,
        sessions: catalog.list().map(publicMeta),
      });
      return;
    }
    if (req.method === "GET" && sessionMatch) {
      const id = decodeURIComponent(sessionMatch[1]);
      if (!isSessionId(id)) {
        sendJson(res, 400, { ok: false, error: "会话 ID 无效" });
        return;
      }
      const meta = catalog.get(id);
      if (!meta) {
        sendJson(res, 404, { ok: false, error: "会话不存在" });
        return;
      }
      sendJson(res, 200, {
        ...publicMeta(meta),
        messages: messagesFor(id),
        lastError: meta.lastError ?? null,
      });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/chat") {
      const raw = await readBody(req);
      let text = "";
      let sessionId = "";
      try {
        const parsed = JSON.parse(raw) as { text?: unknown; sessionId?: unknown };
        text = typeof parsed.text === "string" ? parsed.text.trim() : "";
        sessionId = typeof parsed.sessionId === "string" ? parsed.sessionId : "";
      } catch {
        sendJson(res, 400, { ok: false, error: "请求体不是 JSON" });
        return;
      }
      if (!isSessionId(sessionId)) {
        sendJson(res, 400, { ok: false, error: "缺少有效的会话 ID" });
        return;
      }
      if (!text) {
        sendJson(res, 400, { ok: false, sessionId, error: "请输入消息" });
        return;
      }
      if (phase !== "ready") {
        sendJson(res, 503, { ok: false, sessionId, error: bootError || "Agent 尚未就绪" });
        return;
      }
      const result = await handleChat(sessionId, text);
      sendJson(res, result.status, result);
      return;
    }
    sendJson(res, 404, { ok: false, error: "未找到" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendJson(res, 500, { ok: false, error: message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`IssuePilot chat: http://${HOST}:${PORT}`);
});

void boot();
