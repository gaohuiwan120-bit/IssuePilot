import { readdirSync, readFileSync, statSync, lstatSync } from "node:fs";
import { join, relative, sep, extname } from "node:path";
import type { IssueSpec } from "../schema/types.js";
import { ToolRuntime, isSkippedDirName, SENSITIVE_NAME_RE } from "./context.js";
import { IssueToolError } from "./errors.js";

export interface FindRelatedCodeInput {
  taskId: string;
  repositoryPath: string;
  issueSpec: IssueSpec;
  maxResults?: number;
}

export interface RelatedCodeMatch {
  filePath: string;
  symbol?: string;
  lineStart?: number;
  lineEnd?: number;
  matchReasons: string[];
  relevanceScore: number;
}

const TEXT_EXTS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".json",
  ".md",
  ".yml",
  ".yaml",
  ".toml",
  ".txt",
]);

export function findRelatedCode(input: FindRelatedCodeInput): RelatedCodeMatch[] {
  const started = Date.now();
  const runtime = new ToolRuntime(input.taskId, input.repositoryPath, { stage: "inspect" });
  const maxResults = input.maxResults ?? 20;
  try {
    const spec = input.issueSpec;
    const keywords = collectKeywords(spec);
    const matches = new Map<string, RelatedCodeMatch>();

    walkTextFiles(runtime.repositoryPath, runtime.maxFiles, runtime.maxFileBytes, (abs, rel, content) => {
      if (SENSITIVE_NAME_RE.test(rel)) return;
      const reasons: string[] = [];
      let score = 0;
      let symbol: string | undefined;
      let lineStart: number | undefined;

      for (const fileHint of spec.mentionedFiles) {
        const norm = fileHint.replace(/\\/g, "/");
        if (rel === norm || rel.endsWith("/" + norm) || rel.endsWith(norm)) {
          reasons.push(`mentioned file: ${norm}`);
          score += 50;
        }
      }

      for (const sym of spec.mentionedSymbols) {
        if (content.includes(sym)) {
          reasons.push(`symbol: ${sym}`);
          score += 20;
          symbol = symbol ?? sym;
          const idx = content.indexOf(sym);
          lineStart = content.slice(0, idx).split("\n").length;
        }
      }

      for (const kw of keywords) {
        if (kw.length < 3) continue;
        const re = new RegExp(escapeRegExp(kw), "i");
        if (re.test(rel)) {
          reasons.push(`path keyword: ${kw}`);
          score += 15;
        } else if (re.test(content)) {
          reasons.push(`content keyword: ${kw}`);
          score += 8;
        }
      }

      // stack-like path:line
      for (const m of `${spec.description}\n${spec.actualBehavior ?? ""}`.matchAll(
        /([\w./\\-]+\.(?:ts|tsx|js|jsx|py)):(\d+)/g,
      )) {
        const f = m[1].replace(/\\/g, "/");
        if (rel.endsWith(f) || rel === f) {
          reasons.push(`stack frame: ${f}:${m[2]}`);
          score += 40;
          lineStart = Number(m[2]);
        }
      }

      // API path hints
      for (const m of `${spec.description}\n${spec.title}`.matchAll(/\/api\/[\w/-]+/g)) {
        if (content.includes(m[0])) {
          reasons.push(`api path: ${m[0]}`);
          score += 18;
        }
      }

      if (score > 0 && reasons.length > 0) {
        const key = rel;
        const prev = matches.get(key);
        if (!prev || prev.relevanceScore < score) {
          matches.set(key, {
            filePath: rel,
            symbol,
            lineStart,
            lineEnd: lineStart,
            matchReasons: unique(reasons),
            relevanceScore: score,
          });
        }
      }
    });

    const sorted = [...matches.values()].sort((a, b) => b.relevanceScore - a.relevanceScore);
    const limited = sorted.slice(0, maxResults);
    runtime.trace("find_related_code", true, `matches=${limited.length}`, {
      durationMs: Date.now() - started,
    });
    return limited;
  } catch (e) {
    runtime.trace("find_related_code", false, e instanceof Error ? e.message : String(e), {
      errorCode: e instanceof IssueToolError ? e.code : "INVALID_INPUT",
      durationMs: Date.now() - started,
    });
    throw e;
  }
}

function collectKeywords(spec: IssueSpec): string[] {
  const text = [
    spec.title,
    spec.description,
    spec.actualBehavior ?? "",
    spec.expectedBehavior ?? "",
    ...spec.reproductionSteps,
    ...spec.acceptanceCriteria,
  ].join(" ");
  const tokens = text
    .split(/[^A-Za-z0-9_./-]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !/^(the|and|for|with|that|this|from|into)$/i.test(t));
  return unique(tokens).slice(0, 40);
}

function walkTextFiles(
  root: string,
  maxFiles: number,
  maxBytes: number,
  onFile: (abs: string, rel: string, content: string) => void,
): void {
  let count = 0;
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      if (isSkippedDirName(ent.name)) continue;
      const abs = join(dir, ent.name);
      try {
        if (ent.isSymbolicLink() || lstatSync(abs).isSymbolicLink()) continue;
        if (ent.isDirectory()) {
          stack.push(abs);
          continue;
        }
        if (!ent.isFile()) continue;
        const ext = extname(ent.name).toLowerCase();
        if (!TEXT_EXTS.has(ext)) continue;
        count += 1;
        if (count > maxFiles) {
          throw new IssueToolError("FILE_LIMIT_EXCEEDED", `file limit ${maxFiles}`);
        }
        const st = statSync(abs);
        if (st.size > maxBytes) continue;
        const content = readFileSync(abs, "utf8");
        const rel = relative(root, abs).split(sep).join("/");
        onFile(abs, rel, content);
      } catch (e) {
        if (e instanceof IssueToolError) throw e;
      }
    }
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function unique(xs: string[]): string[] {
  return [...new Set(xs)];
}
