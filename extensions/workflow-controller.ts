import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createRuntimeState,
  enterStage,
  markInterrupted,
  recordRetry,
  DEFAULT_WORKFLOW_LIMITS,
} from "../dist/workflow/runtime-control.js";
import { createRunRecorder } from "../dist/trace/run-recorder.js";
import type { WorkflowStage } from "../dist/workflow/stages.js";

const NEXT: Record<string, string> = {
  understand: "inspect",
  inspect: "reproduce",
  reproduce: "diagnose",
  diagnose: "plan",
  plan: "approve",
  approve: "checkpoint",
  checkpoint: "patch",
  patch: "test",
  test: "review",
  review: "report",
  report: "completed",
};

function statePath(cwd: string) {
  return join(cwd, ".issuepilot", "workflow-state.json");
}

function load(cwd: string) {
  try {
    return JSON.parse(readFileSync(statePath(cwd), "utf8"));
  } catch {
    return {
      stage: "understand",
      approvalGranted: false,
      retryCount: 0,
      checkpointCreated: false,
    };
  }
}

function save(cwd: string, s: object) {
  mkdirSync(join(cwd, ".issuepilot"), { recursive: true });
  writeFileSync(statePath(cwd), JSON.stringify(s, null, 2));
}

export default function (pi: ExtensionAPI) {
  let runtime = createRuntimeState("understand");

  pi.on("session_start", async (_, ctx) => {
    const s = load(ctx.cwd);
    runtime = createRuntimeState(s.stage);
    (globalThis as any).__issuepilot_stage = s.stage;
    (globalThis as any).__issuepilot_runtime = runtime;
    ctx.ui.setStatus("issuepilot", "Stage: " + s.stage);
  });

  pi.registerCommand("issuepilot-advance", {
    description: "Advance IssuePilot workflow",
    handler: async (_, ctx) => {
      const s = load(ctx.cwd);
      const n = NEXT[s.stage];
      if (!n) return ctx.ui.notify("Workflow complete or terminal", "info");
      if (s.stage === "approve" && !s.approvalGranted) {
        return ctx.ui.notify("Run /issuepilot-approve first", "warning");
      }
      if (s.stage === "checkpoint" && !s.checkpointCreated) {
        return ctx.ui.notify("Run /issuepilot-checkpoint first", "warning");
      }
      const taskId =
        (globalThis as any).__issuepilot_task_id ||
        process.env.ISSUEPILOT_TASK_ID ||
        "default";
      const recorder = createRunRecorder(ctx.cwd, taskId);
      const duration = recorder.markStageEnd(s.stage as WorkflowStage);
      recorder.append({
        stage: s.stage as WorkflowStage,
        eventType: "stage_end",
        success: true,
        durationMs: duration,
        summary: `leave ${s.stage}`,
      });

      runtime = enterStage(runtime, n as WorkflowStage);
      (globalThis as any).__issuepilot_runtime = runtime;
      save(ctx.cwd, { ...s, stage: n });
      (globalThis as any).__issuepilot_stage = n;
      recorder.markStageStart(n as WorkflowStage);
      recorder.append({
        stage: n as WorkflowStage,
        eventType: "stage_start",
        success: true,
        summary: `enter ${n}`,
      });
      ctx.ui.setStatus("issuepilot", "Stage: " + n);
      ctx.ui.notify("Advanced to " + n, "info");
    },
  });

  pi.registerCommand("issuepilot-approve", {
    description: "Approve repair plan",
    handler: async (_, ctx) => {
      const ok = ctx.hasUI
        ? await ctx.ui.confirm("IssuePilot APPROVE", "Allow controlled changes?")
        : false;
      save(ctx.cwd, { ...load(ctx.cwd), approvalGranted: ok });
      ctx.ui.notify(ok ? "Approved" : "Rejected", ok ? "info" : "warning");
    },
  });

  pi.registerCommand("issuepilot-retry", {
    description: "Retry after test failure (back to diagnose)",
    handler: async (_, ctx) => {
      const s = load(ctx.cwd);
      const result = recordRetry(runtime, DEFAULT_WORKFLOW_LIMITS);
      runtime = result.state;
      (globalThis as any).__issuepilot_runtime = runtime;
      if (!result.decision.allow) {
        return ctx.ui.notify(result.decision.reason ?? "retry denied", "error");
      }
      save(ctx.cwd, {
        ...s,
        stage: "diagnose",
        retryCount: (s.retryCount || 0) + 1,
      });
      runtime = enterStage(runtime, "diagnose");
      ctx.ui.notify("Retry -> diagnose", "info");
    },
  });

  pi.registerCommand("issuepilot-interrupt", {
    description: "Mark workflow interrupted by user",
    handler: async (_, ctx) => {
      runtime = markInterrupted(runtime, "user interrupt");
      (globalThis as any).__issuepilot_runtime = runtime;
      const taskId =
        (globalThis as any).__issuepilot_task_id ||
        process.env.ISSUEPILOT_TASK_ID ||
        "default";
      createRunRecorder(ctx.cwd, taskId).append({
        stage: (runtime.stage as WorkflowStage) || "failed",
        eventType: "interrupt",
        success: false,
        summary: "user interrupt",
        errorCode: "INTERRUPTED",
      });
      ctx.ui.notify("Interrupted", "warning");
    },
  });

  pi.on("session_before_tree", async (_, ctx) =>
    pi.appendEntry({
      type: "custom",
      customType: "issuepilot_tree",
      data: { stage: load(ctx.cwd).stage },
    }),
  );

  pi.on("session_before_compact", async (_, ctx) =>
    ctx.ui.notify("IssuePilot: workflow-state.json preserved", "info"),
  );
}
