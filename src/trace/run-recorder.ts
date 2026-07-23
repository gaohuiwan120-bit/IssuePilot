import { appendFileSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { RiskLevel } from "../risk/levels.js";
import type { WorkflowStage } from "../workflow/stages.js";
import { assertValidTaskId } from "../artifacts/names.js";

export interface RunTraceEvent {
  eventId: string;
  taskId: string;
  timestamp: string;
  stage: WorkflowStage;
  eventType: string;
  toolName?: string;
  durationMs?: number;
  success: boolean;
  riskLevel?: RiskLevel;
  approvalId?: string;
  summary: string;
  errorCode?: string;
  detailPath?: string;
}

export interface TraceSummary {
  taskId: string;
  totalEvents: number;
  toolCalls: number;
  toolFailures: number;
  approvals: number;
  blockedOps: number;
  stageDurationsMs: Partial<Record<WorkflowStage, number>>;
}

const SENSITIVE_KEY_RE =
  /(api[_-]?key|token|secret|password|authorization|auth\.json|BEGIN [A-Z ]*PRIVATE KEY)/i;

export function redactSummary(text: string): string {
  let s = String(text ?? "");
  s = s.replace(/(Bearer\s+)[A-Za-z0-9._\-]+/gi, "$1[REDACTED]");
  s = s.replace(/([A-Za-z0-9_]*(?:key|token|secret)[A-Za-z0-9_]*\s*[=:]\s*)["']?[^"'}\s,]+/gi, "$1[REDACTED]");
  if (SENSITIVE_KEY_RE.test(s) && s.length > 200) {
    return s.slice(0, 120) + "…[redacted]";
  }
  return s.length > 500 ? s.slice(0, 500) + "…" : s;
}

export class RunRecorder {
  readonly taskId: string;
  readonly tracePath: string;
  readonly detailsDir: string;
  private stageStarted = new Map<WorkflowStage, number>();

  constructor(outputsRoot: string, taskId: string) {
    assertValidTaskId(taskId);
    this.taskId = taskId;
    const root = join(outputsRoot, taskId);
    mkdirSync(root, { recursive: true });
    this.tracePath = join(root, "run_trace.jsonl");
    this.detailsDir = join(root, "trace-details");
    mkdirSync(this.detailsDir, { recursive: true });
  }

  append(event: Omit<RunTraceEvent, "eventId" | "taskId" | "timestamp"> & Partial<Pick<RunTraceEvent, "eventId" | "timestamp">>): RunTraceEvent {
    const full: RunTraceEvent = {
      eventId: event.eventId ?? randomUUID(),
      taskId: this.taskId,
      timestamp: event.timestamp ?? new Date().toISOString(),
      stage: event.stage,
      eventType: event.eventType,
      toolName: event.toolName,
      durationMs: event.durationMs,
      success: event.success,
      riskLevel: event.riskLevel,
      approvalId: event.approvalId,
      summary: redactSummary(event.summary),
      errorCode: event.errorCode,
      detailPath: event.detailPath,
    };
    try {
      appendFileSync(this.tracePath, JSON.stringify(full) + "\n", "utf8");
    } catch (err) {
      throw new Error(`failed to write run_trace.jsonl: ${String(err)}`);
    }
    return full;
  }

  /** Persist large stdout/stderr to a side file; return relative detail path. */
  writeDetail(name: string, content: string): string {
    const safe = name.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80);
    const file = join(this.detailsDir, `${Date.now()}-${safe}.txt`);
    writeFileSync(file, content, "utf8");
    return file;
  }

  markStageStart(stage: WorkflowStage): void {
    this.stageStarted.set(stage, Date.now());
  }

  markStageEnd(stage: WorkflowStage): number | undefined {
    const start = this.stageStarted.get(stage);
    if (start === undefined) return undefined;
    return Date.now() - start;
  }

  summarize(): TraceSummary {
    if (!existsSync(this.tracePath)) {
      return {
        taskId: this.taskId,
        totalEvents: 0,
        toolCalls: 0,
        toolFailures: 0,
        approvals: 0,
        blockedOps: 0,
        stageDurationsMs: {},
      };
    }
    const lines = readFileSync(this.tracePath, "utf8").split("\n").filter(Boolean);
    let toolCalls = 0;
    let toolFailures = 0;
    let approvals = 0;
    let blockedOps = 0;
    const stageDurationsMs: Partial<Record<WorkflowStage, number>> = {};
    for (const line of lines) {
      const ev = JSON.parse(line) as RunTraceEvent;
      if (ev.eventType === "tool_call" || ev.eventType === "tool_result") toolCalls += 1;
      if (ev.eventType === "tool_result" && !ev.success) toolFailures += 1;
      if (ev.eventType === "approval") approvals += 1;
      if (ev.eventType === "blocked" || ev.riskLevel === "blocked") blockedOps += 1;
      if (ev.eventType === "stage_end" && ev.durationMs !== undefined) {
        stageDurationsMs[ev.stage] = (stageDurationsMs[ev.stage] ?? 0) + ev.durationMs;
      }
    }
    return {
      taskId: this.taskId,
      totalEvents: lines.length,
      toolCalls,
      toolFailures,
      approvals,
      blockedOps,
      stageDurationsMs,
    };
  }
}

export function createRunRecorder(cwd: string, taskId: string): RunRecorder {
  return new RunRecorder(join(cwd, "outputs"), taskId);
}
