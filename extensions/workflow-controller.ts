import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

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
  pi.on("session_start", async (_, ctx) => {
    const s = load(ctx.cwd);
    (globalThis as any).__issuepilot_stage = s.stage;
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
      save(ctx.cwd, { ...s, stage: n });
      (globalThis as any).__issuepilot_stage = n;
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
      save(ctx.cwd, {
        ...s,
        stage: "diagnose",
        retryCount: (s.retryCount || 0) + 1,
      });
      ctx.ui.notify("Retry -> diagnose", "info");
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
