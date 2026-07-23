import type { DiagnosisResult, IssueSpec, VerificationStatus } from "../schema/types.js";
import type { RelatedCodeMatch } from "./find-related-code.js";
import type { ReproductionResult } from "../schema/types.js";
import { ToolRuntime } from "./context.js";
import { IssueToolError } from "./errors.js";

export type DiagnosisCategory =
  | "validation"
  | "configuration"
  | "file-path"
  | "dependency"
  | "exception-handling"
  | "type-error"
  | "null-or-undefined"
  | "test-failure"
  | "build-failure"
  | "unknown";

export interface DiagnoseIssueInput {
  taskId: string;
  repositoryPath: string;
  issueSpec: IssueSpec;
  reproduction?: ReproductionResult | null;
  relatedCode?: RelatedCodeMatch[];
}

const RULES: Array<{ category: DiagnosisCategory; re: RegExp; weight: number }> = [
  { category: "null-or-undefined", re: /TypeError:.*undefined|Cannot read propert|NoneType/i, weight: 0.8 },
  { category: "type-error", re: /TypeError|type\s+mismatch|is not assignable/i, weight: 0.7 },
  { category: "validation", re: /validation|invalid\s+(argument|input|param)|assert/i, weight: 0.65 },
  { category: "configuration", re: /config|ENOENT.*\.(json|ya?ml|toml|env)|missing\s+config/i, weight: 0.7 },
  { category: "file-path", re: /ENOENT|no such file|path\s+not\s+found|FileNotFoundError/i, weight: 0.75 },
  { category: "dependency", re: /Cannot find module|ModuleNotFoundError|not found:|peer dep/i, weight: 0.8 },
  { category: "exception-handling", re: /Unhandled|uncaught|traceback|Exception/i, weight: 0.55 },
  { category: "test-failure", re: /FAIL\s|AssertionError|expected .* to|tests? failed/i, weight: 0.7 },
  { category: "build-failure", re: /build failed|TS\d{4}|compilation error|error TS/i, weight: 0.75 },
];

export function diagnoseIssue(input: DiagnoseIssueInput): DiagnosisResult {
  const started = Date.now();
  const runtime = new ToolRuntime(input.taskId, input.repositoryPath, { stage: "diagnose" });
  try {
    const text = [
      input.issueSpec.title,
      input.issueSpec.description,
      input.issueSpec.actualBehavior ?? "",
      ...(input.reproduction?.logs ?? []),
      input.reproduction?.observedBehavior ?? "",
      ...(input.reproduction?.failingTests ?? []),
    ].join("\n");

    const scores = new Map<DiagnosisCategory, number>();
    const evidence: string[] = [];
    for (const rule of RULES) {
      if (rule.re.test(text)) {
        scores.set(rule.category, Math.max(scores.get(rule.category) ?? 0, rule.weight));
        evidence.push(`pattern:${rule.category}`);
      }
    }

    if (input.reproduction?.failingTests?.length) {
      scores.set("test-failure", Math.max(scores.get("test-failure") ?? 0, 0.85));
      evidence.push(...input.reproduction.failingTests.map((t) => `failingTest:${t}`));
    }
    if (input.reproduction && input.reproduction.exitCodes.some((c) => c !== 0)) {
      evidence.push(`exitCodes:${input.reproduction.exitCodes.join(",")}`);
    }

    const related = input.relatedCode ?? [];
    const suspectedFiles = unique([
      ...input.issueSpec.mentionedFiles,
      ...related.slice(0, 5).map((r) => r.filePath),
    ]);
    const suspectedSymbols = unique([
      ...input.issueSpec.mentionedSymbols,
      ...related.map((r) => r.symbol).filter(Boolean) as string[],
    ]);
    const callChain = extractCallChain(text);

    const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
    const candidates =
      ranked.length > 0
        ? ranked.map(([c, w]) => `${c} (score=${w.toFixed(2)})`)
        : ["unknown (insufficient evidence)"];

    const top = ranked[0];
    let confidence = top ? top[1] : 0.2;
    let verificationStatus: VerificationStatus = "unverified";
    let summary: string;

    if (!top || top[1] < 0.5) {
      summary = "Unable to confirm a single root cause from deterministic signals.";
      confidence = Math.min(confidence, 0.35);
      verificationStatus = "unverified";
    } else if (ranked.length > 1 && Math.abs((ranked[0]?.[1] ?? 0) - (ranked[1]?.[1] ?? 0)) < 0.1) {
      summary = `Multiple candidate categories: ${ranked
        .slice(0, 3)
        .map((x) => x[0])
        .join(", ")}.`;
      verificationStatus = "partially_verified";
      confidence = Math.min(confidence, 0.6);
    } else {
      summary = `Likely category: ${top[0]}.`;
      verificationStatus = input.reproduction?.reproduced ? "partially_verified" : "unverified";
    }

    const missingEvidence: string[] = [];
    if (!input.reproduction) missingEvidence.push("reproduction");
    if (suspectedFiles.length === 0) missingEvidence.push("suspectedFiles");
    if (!input.reproduction?.reproduced) missingEvidence.push("confirmedReproduction");

    const result: DiagnosisResult = {
      taskId: input.taskId,
      summary,
      rootCauseCandidates: candidates,
      evidence: unique(evidence),
      suspectedFiles,
      suspectedSymbols,
      callChain,
      confidence,
      verificationStatus,
      missingEvidence,
    };

    runtime.store.writeJson("diagnosis.json", result);
    runtime.trace("diagnose_issue", true, summary, { durationMs: Date.now() - started });
    return result;
  } catch (e) {
    runtime.trace("diagnose_issue", false, e instanceof Error ? e.message : String(e), {
      errorCode: e instanceof IssueToolError ? e.code : "INVALID_INPUT",
      durationMs: Date.now() - started,
    });
    throw e;
  }
}

function extractCallChain(text: string): string[] {
  const chain: string[] = [];
  for (const line of text.split("\n")) {
    if (/^\s*at\s+/.test(line) || /File \".+\", line \d+/.test(line)) {
      chain.push(line.trim());
    }
  }
  return chain.slice(0, 20);
}

function unique(xs: string[]): string[] {
  return [...new Set(xs.filter(Boolean))];
}
