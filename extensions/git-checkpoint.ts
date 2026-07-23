import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  createGitCheckpoint,
  planRollback,
  inspectGitRepo,
} from "../dist/git/checkpoint.js";
import { createRunRecorder } from "../dist/trace/run-recorder.js";
import type { WorkflowStage } from "../dist/workflow/stages.js";

export default function (pi: ExtensionAPI) {
  pi.registerCommand("issuepilot-checkpoint", {
    description: "Create a safe IssuePilot git checkpoint (branch strategy)",
    handler: async (_args, ctx) => {
      const taskId =
        (globalThis as any).__issuepilot_task_id ||
        process.env.ISSUEPILOT_TASK_ID ||
        "default";
      const stage = ((globalThis as any).__issuepilot_stage ||
        "checkpoint") as WorkflowStage;
      const recorder = createRunRecorder(ctx.cwd, taskId);

      const status = inspectGitRepo(ctx.cwd);
      if (!status.isGitRepo) {
        ctx.ui.notify("Not a git repository", "error");
        recorder.append({
          stage,
          eventType: "checkpoint",
          success: false,
          summary: "not a git repository",
          errorCode: "NOT_GIT",
        });
        return;
      }

      const result = createGitCheckpoint({
        taskId,
        cwd: ctx.cwd,
        strategy: "branch",
        dryRun: false,
        allowDirty: false,
      });

      if (!result.ok || !result.checkpoint) {
        ctx.ui.notify(result.reason ?? "checkpoint failed", "warning");
        recorder.append({
          stage,
          eventType: "checkpoint",
          success: false,
          summary: result.reason ?? "checkpoint failed",
          errorCode: "CHECKPOINT_REFUSED",
        });
        return;
      }

      (globalThis as any).__issuepilot_checkpoint = result.checkpoint;
      recorder.append({
        stage,
        eventType: "checkpoint",
        success: true,
        summary: `strategy=${result.checkpoint.strategy} branch=${result.checkpoint.repairBranch} base=${result.checkpoint.baseCommit.slice(0, 8)}`,
      });
      ctx.ui.notify(
        `Checkpoint OK (${result.checkpoint.strategy}): ${result.checkpoint.repairBranch}`,
        "info",
      );
    },
  });

  pi.registerCommand("issuepilot-rollback-plan", {
    description: "Show rollback plan for last checkpoint (dry-run, no mutation)",
    handler: async (_args, ctx) => {
      const cp = (globalThis as any).__issuepilot_checkpoint;
      if (!cp) {
        ctx.ui.notify("No checkpoint in session", "warning");
        return;
      }
      const plan = planRollback(cp);
      ctx.ui.notify(plan.join(" | "), "info");
    },
  });
}
