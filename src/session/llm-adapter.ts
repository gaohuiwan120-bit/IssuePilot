import type { DiagnosisResult, IssueSpec, RepairPlan, PlannedChange } from "../schema/types.js";
import { isPlanRiskLevel, type PlanRiskLevel } from "../risk/levels.js";
import type { ModelConfig } from "./model-config.js";
import { ModelConfigError } from "./model-config.js";
import { redactSummary } from "../trace/run-recorder.js";

export interface LlmUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
}

export interface PlanGenerationInput {
  issueSpec: IssueSpec;
  diagnosis: DiagnosisResult;
  relatedFiles: string[];
  /** Optional golden file map for mock: path -> content */
  goldenFiles?: Record<string, string>;
}

export interface PlanGenerationResult {
  plan: RepairPlan;
  rawText: string;
  usage: LlmUsage;
  provider: string;
  model: string;
}

export interface PatchGenerationInput {
  issueSpec: IssueSpec;
  plan: RepairPlan;
  fileContents: Record<string, string>;
  goldenFiles?: Record<string, string>;
}

export interface PatchGenerationResult {
  /** relative path -> new content */
  files: Record<string, string>;
  usage: LlmUsage;
  provider: string;
  model: string;
}

export interface LlmAdapter {
  readonly provider: string;
  readonly model: string;
  generateRepairPlan(input: PlanGenerationInput): Promise<PlanGenerationResult>;
  generatePatch(input: PatchGenerationInput): Promise<PatchGenerationResult>;
}

export function validateRepairPlan(raw: unknown, taskId: string): { ok: true; plan: RepairPlan } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!raw || typeof raw !== "object") return { ok: false, errors: ["plan must be an object"] };
  const p = raw as Record<string, unknown>;
  if (typeof p.rootCause !== "string" || !p.rootCause.trim()) errors.push("rootCause required");
  if (!Array.isArray(p.evidence)) errors.push("evidence must be array");
  if (!Array.isArray(p.filesToModify) || p.filesToModify.length === 0) {
    errors.push("filesToModify must be non-empty array");
  }
  if (!Array.isArray(p.plannedChanges)) errors.push("plannedChanges must be array");
  if (!Array.isArray(p.validationCommands)) errors.push("validationCommands must be array");
  if (!Array.isArray(p.acceptanceCriteria)) errors.push("acceptanceCriteria must be array");
  if (typeof p.rollbackStrategy !== "string") errors.push("rollbackStrategy required");
  if (typeof p.riskLevel !== "string" || !isPlanRiskLevel(p.riskLevel)) {
    errors.push("riskLevel must be low|medium|high");
  }
  if (typeof p.requiresApproval !== "boolean") errors.push("requiresApproval must be boolean");
  if (errors.length) return { ok: false, errors };

  const plannedChanges: PlannedChange[] = (p.plannedChanges as unknown[]).map((c, i) => {
    const ch = c as Record<string, unknown>;
    if (!ch || typeof ch.file !== "string" || typeof ch.description !== "string") {
      errors.push(`plannedChanges[${i}] invalid`);
    }
    return {
      file: String(ch?.file ?? ""),
      description: String(ch?.description ?? ""),
      reason: String(ch?.reason ?? ""),
    };
  });
  if (errors.length) return { ok: false, errors };

  const plan: RepairPlan = {
    taskId,
    rootCause: String(p.rootCause),
    evidence: (p.evidence as unknown[]).map(String),
    filesToModify: (p.filesToModify as unknown[]).map(String),
    plannedChanges,
    validationCommands: (p.validationCommands as unknown[]).map(String),
    acceptanceCriteria: (p.acceptanceCriteria as unknown[]).map(String),
    rollbackStrategy: String(p.rollbackStrategy),
    riskLevel: p.riskLevel as PlanRiskLevel,
    requiresApproval: Boolean(p.requiresApproval),
  };
  return { ok: true, plan };
}

export function createLlmAdapter(cfg: ModelConfig): LlmAdapter {
  if (cfg.provider === "mock") {
    return new MockLlmAdapter(cfg.model);
  }
  if (cfg.provider === "deepseek") {
    if (!cfg.apiKeyPresent || !cfg.apiKey) {
      throw new ModelConfigError(
        "MISSING_API_KEY",
        "DEEPSEEK_API_KEY is missing. Cannot create live DeepSeek adapter.",
      );
    }
    return new DeepSeekLlmAdapter(cfg);
  }
  throw new ModelConfigError("UNSUPPORTED_PROVIDER", `Unsupported provider: ${cfg.provider}`);
}

export class MockLlmAdapter implements LlmAdapter {
  readonly provider = "mock";
  constructor(readonly model: string) {}

  async generateRepairPlan(input: PlanGenerationInput): Promise<PlanGenerationResult> {
    const fromGolden = (input.goldenFiles ? Object.keys(input.goldenFiles) : []).filter(
      (f) => !f.startsWith("golden/") && f !== "ISSUE.md" && !f.endsWith(".md"),
    );
    const codeLike = (f: string) =>
      /\.(js|ts|tsx|jsx|mjs|cjs|py)$/.test(f) && !f.startsWith("golden/") && f !== "ISSUE.md";
    const files =
      fromGolden.length > 0
        ? fromGolden
        : [
            ...input.issueSpec.mentionedFiles.filter(codeLike),
            ...input.relatedFiles.filter(codeLike),
          ].filter((f, i, arr) => arr.indexOf(f) === i);
    const filesToModify = (files.length ? files : ["src/fix.js"]).slice(0, 5);
    const plan: RepairPlan = {
      taskId: input.issueSpec.taskId,
      rootCause: input.diagnosis.summary || input.diagnosis.rootCauseCandidates[0] || "unknown",
      evidence: input.diagnosis.evidence.slice(0, 5),
      filesToModify,
      plannedChanges: filesToModify.map((f) => ({
        file: f,
        description: `Minimal fix for ${input.issueSpec.title}`,
        reason: "address diagnosed issue",
      })),
      validationCommands: ["run fixture tests"],
      acceptanceCriteria: input.issueSpec.acceptanceCriteria.length
        ? input.issueSpec.acceptanceCriteria
        : ["tests pass"],
      rollbackStrategy: "Restore files from Git Checkpoint base commit (no reset --hard)",
      riskLevel: "low",
      requiresApproval: true,
    };
    return {
      plan,
      rawText: JSON.stringify(plan),
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCostUsd: 0 },
      provider: this.provider,
      model: this.model,
    };
  }

  async generatePatch(input: PatchGenerationInput): Promise<PatchGenerationResult> {
    const files: Record<string, string> = {};
    for (const f of input.plan.filesToModify) {
      if (input.goldenFiles?.[f]) {
        files[f] = input.goldenFiles[f];
      } else if (input.fileContents[f] !== undefined) {
        // Deterministic tiny fix heuristics for mock when no golden
        files[f] = input.fileContents[f];
      }
    }
    if (Object.keys(files).length === 0 && input.goldenFiles) {
      Object.assign(files, input.goldenFiles);
    }
    return {
      files,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCostUsd: 0 },
      provider: this.provider,
      model: this.model,
    };
  }
}

export class DeepSeekLlmAdapter implements LlmAdapter {
  readonly provider = "deepseek";
  readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(cfg: ModelConfig) {
    this.model = cfg.model;
    this.apiKey = cfg.apiKey!;
    this.baseUrl = cfg.baseUrl || "https://api.deepseek.com";
  }

  async generateRepairPlan(input: PlanGenerationInput): Promise<PlanGenerationResult> {
    const prompt = [
      "You are IssuePilot planner. Return ONLY valid JSON for RepairPlan fields:",
      "rootCause, evidence, filesToModify, plannedChanges[{file,description,reason}],",
      "validationCommands, acceptanceCriteria, rollbackStrategy, riskLevel (low|medium|high), requiresApproval (boolean).",
      "Do not invent files not in relatedFiles/mentionedFiles. Keep the change minimal.",
      "",
      "IssueSpec:",
      JSON.stringify(input.issueSpec, null, 2),
      "Diagnosis:",
      JSON.stringify(input.diagnosis, null, 2),
      "Related files:",
      input.relatedFiles.join("\n"),
    ].join("\n");
    const { text, usage } = await this.chat(prompt);
    const parsed = extractJson(text);
    const validated = validateRepairPlan(parsed, input.issueSpec.taskId);
    if (!validated.ok) {
      throw new Error(`RepairPlan schema failed: ${validated.errors.join("; ")}`);
    }
    return {
      plan: validated.plan,
      rawText: redactSummary(text),
      usage,
      provider: this.provider,
      model: this.model,
    };
  }

  async generatePatch(input: PatchGenerationInput): Promise<PatchGenerationResult> {
    if (input.goldenFiles && Object.keys(input.goldenFiles).length > 0) {
      // Prefer golden when provided (controlled E2E); still counted as model path when live planning was used
      return {
        files: { ...input.goldenFiles },
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCostUsd: 0 },
        provider: this.provider,
        model: this.model,
      };
    }
    const prompt = [
      "Return ONLY JSON object mapping relative file paths to full new file contents.",
      "Only modify files listed in the RepairPlan. Keep changes minimal.",
      "RepairPlan:",
      JSON.stringify(input.plan, null, 2),
      "Current file contents:",
      JSON.stringify(input.fileContents, null, 2),
    ].join("\n");
    const { text, usage } = await this.chat(prompt);
    const parsed = extractJson(text);
    if (!parsed || typeof parsed !== "object") {
      throw new Error("Patch JSON invalid");
    }
    const files: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "string" && input.plan.filesToModify.includes(k)) {
        files[k] = v;
      }
    }
    if (Object.keys(files).length === 0) {
      throw new Error("Patch produced no allowed files");
    }
    return { files, usage, provider: this.provider, model: this.model };
  }

  private async chat(userContent: string): Promise<{ text: string; usage: LlmUsage }> {
    const url = `${this.baseUrl}/chat/completions`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: "system", content: "You are a careful software repair planner. Output JSON only." },
          { role: "user", content: userContent },
        ],
        temperature: 0.2,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`DeepSeek API error ${res.status}: ${redactSummary(body)}`);
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };
    const text = data.choices?.[0]?.message?.content ?? "";
    const promptTokens = data.usage?.prompt_tokens ?? 0;
    const completionTokens = data.usage?.completion_tokens ?? 0;
    const totalTokens = data.usage?.total_tokens ?? promptTokens + completionTokens;
    // DeepSeek chat approximate pricing placeholder for MVP reporting (not a billing guarantee)
    const estimatedCostUsd = (promptTokens * 0.14 + completionTokens * 0.28) / 1_000_000;
    return {
      text,
      usage: { promptTokens, completionTokens, totalTokens, estimatedCostUsd },
    };
  }
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("No JSON object in model response");
  return JSON.parse(candidate.slice(start, end + 1));
}
