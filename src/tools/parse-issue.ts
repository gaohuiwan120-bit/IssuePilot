import type { IssueSpec, IssueType } from "../schema/types.js";
import { ToolRuntime } from "./context.js";
import { IssueToolError } from "./errors.js";

export interface ParseIssueInput {
  taskId: string;
  title?: string;
  body: string;
  labels?: string[];
  source?: "github" | "local" | "manual";
}

const FILE_PATH_RE =
  /(?:^|[\s`"'(])((?:[\w.-]+\/)+[\w.-]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|cs|rb|php|md|json|ya?ml|toml))(?=[\s`"''),:]|$)/gim;

const SYMBOL_RE =
  /\b(?:function|class|def|const|let|var|interface|type|enum)\s+([A-Za-z_][\w]*)\b|\b([A-Za-z_][\w]*)\s*\(/g;

const STACK_FILE_RE = /(?:at\s+.*?\()?((?:[A-Za-z]:)?[^:\s()]+\.(?:ts|tsx|js|jsx|py))(?::(\d+))?/g;

export function parseIssue(input: ParseIssueInput, opts?: { repositoryPath?: string }): IssueSpec {
  const started = Date.now();
  if (!input || typeof input.body !== "string") {
    throw new IssueToolError("INVALID_INPUT", "body is required");
  }
  const runtime = opts?.repositoryPath
    ? new ToolRuntime(input.taskId, opts.repositoryPath, { stage: "understand" })
    : null;

  try {
    const body = input.body.replace(/\r\n/g, "\n");
    const title =
      input.title?.trim() ||
      extractMarkdownTitle(body) ||
      firstNonEmptyLine(body) ||
      "Untitled issue";

    const labels = (input.labels ?? []).map((l) => l.toLowerCase());
    const issueType = classifyIssueType(title, body, labels);

    const expectedBehavior = extractSection(body, [
      "expected behavior",
      "expected",
      "期望",
      "预期行为",
    ]);
    const actualBehavior = extractSection(body, [
      "actual behavior",
      "actual",
      "当前行为",
      "实际行为",
      "observed",
    ]);
    const reproductionSteps = extractListSection(body, [
      "steps to reproduce",
      "reproduction steps",
      "repro steps",
      "steps",
      "复现步骤",
    ]);
    const acceptanceCriteria = extractListSection(body, [
      "acceptance criteria",
      "acceptance",
      "definition of done",
      "验收标准",
    ]);

    const description =
      extractSection(body, ["description", "summary", "问题描述", "概述"]) ||
      stripLeadingTitle(body).slice(0, 4000).trim() ||
      title;

    const mentionedFiles = unique([
      ...extractAll(body, FILE_PATH_RE).map((m) => m[1]),
      ...extractStackFiles(body),
    ]);
    const mentionedSymbols = unique(extractSymbols(body)).slice(0, 40);

    const missingInformation: string[] = [];
    if (!expectedBehavior) missingInformation.push("expectedBehavior");
    if (!actualBehavior && issueType === "bug") missingInformation.push("actualBehavior");
    if (reproductionSteps.length === 0 && issueType === "bug") {
      missingInformation.push("reproductionSteps");
    }
    if (acceptanceCriteria.length === 0) missingInformation.push("acceptanceCriteria");

    const spec: IssueSpec = {
      taskId: input.taskId,
      title,
      issueType,
      description,
      expectedBehavior,
      actualBehavior,
      reproductionSteps,
      acceptanceCriteria,
      mentionedFiles,
      mentionedSymbols,
      missingInformation,
    };

    if (runtime) {
      runtime.store.writeJson("issue_spec.json", spec);
      runtime.trace("parse_issue", true, `parsed ${issueType}: ${title}`, {
        durationMs: Date.now() - started,
      });
    }
    return spec;
  } catch (e) {
    if (runtime) {
      runtime.trace("parse_issue", false, e instanceof Error ? e.message : String(e), {
        errorCode: e instanceof IssueToolError ? e.code : "INVALID_INPUT",
        durationMs: Date.now() - started,
      });
    }
    throw e;
  }
}

function classifyIssueType(title: string, body: string, labels: string[]): IssueType {
  const hay = `${title}\n${body}\n${labels.join(" ")}`.toLowerCase();
  if (labels.some((l) => /doc/.test(l)) || /\bdocs?\b|documentation|文档/.test(hay)) {
    return "documentation";
  }
  if (labels.some((l) => /test/.test(l)) || /\b(unit|integration)\s*tests?\b|测试任务/.test(hay)) {
    return "test";
  }
  if (labels.some((l) => /refactor/.test(l)) || /\brefactor\b|重构/.test(hay)) {
    return "refactor";
  }
  if (
    labels.some((l) => /feature|enhancement/.test(l)) ||
    /\bfeature\b|enhancement|新功能|feature request/.test(hay)
  ) {
    return "feature";
  }
  return "bug";
}

function extractMarkdownTitle(body: string): string | null {
  const m = body.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : null;
}

function firstNonEmptyLine(body: string): string | null {
  for (const line of body.split("\n")) {
    const t = line.trim();
    if (t && !t.startsWith("```")) return t.replace(/^#+\s*/, "").slice(0, 200);
  }
  return null;
}

function stripLeadingTitle(body: string): string {
  return body.replace(/^#\s+.+\n+/, "");
}

function extractSection(body: string, headings: string[]): string | null {
  const lines = body.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const h = normalizeHeading(lines[i] ?? "");
    if (!h) continue;
    if (headings.some((x) => h === x || h.startsWith(x))) {
      const buf: string[] = [];
      for (let j = i + 1; j < lines.length; j++) {
        const line = lines[j] ?? "";
        if (isHeading(line)) break;
        buf.push(line);
      }
      const text = buf.join("\n").trim();
      return text || null;
    }
  }
  return null;
}

function extractListSection(body: string, headings: string[]): string[] {
  const section = extractSection(body, headings);
  if (!section) return [];
  const items: string[] = [];
  for (const line of section.split("\n")) {
    const m = line.match(/^\s*(?:[-*]|\d+[.)])\s+(.+)$/);
    if (m) items.push(m[1].trim());
  }
  // Do not invent steps from prose paragraphs
  return items;
}

function normalizeHeading(line: string): string {
  const m = line.match(/^\s{0,3}#{1,6}\s+(.+)$/) || line.match(/^\s{0,3}\*\*(.+?)\*\*\s*:?\s*$/);
  if (!m) return "";
  return m[1].replace(/:$/, "").trim().toLowerCase();
}

function isHeading(line: string): boolean {
  return Boolean(normalizeHeading(line));
}

function extractAll(text: string, re: RegExp): RegExpExecArray[] {
  const out: RegExpExecArray[] = [];
  const r = new RegExp(re.source, re.flags);
  let m: RegExpExecArray | null;
  while ((m = r.exec(text))) out.push(m);
  return out;
}

function extractStackFiles(body: string): string[] {
  const files: string[] = [];
  const r = new RegExp(STACK_FILE_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = r.exec(body))) {
    if (m[1] && !m[1].includes("node_modules")) files.push(m[1].replace(/\\/g, "/"));
  }
  return files;
}

function extractSymbols(body: string): string[] {
  const out: string[] = [];
  const r = new RegExp(SYMBOL_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = r.exec(body))) {
    const name = m[1] || m[2];
    if (name && name.length > 1 && !isCommonKeyword(name)) out.push(name);
  }
  // Explicit backtick symbols
  for (const m2 of body.matchAll(/`([A-Za-z_][\w.]*)`/g)) {
    if (m2[1] && !m2[1].includes("/")) out.push(m2[1]);
  }
  return out;
}

function isCommonKeyword(name: string): boolean {
  return /^(if|for|while|return|function|class|const|let|var|def|import|from|this|new)$/i.test(
    name,
  );
}

function unique(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const i of items) {
    const k = i.replace(/\\/g, "/");
    if (!seen.has(k)) {
      seen.add(k);
      out.push(k);
    }
  }
  return out;
}
