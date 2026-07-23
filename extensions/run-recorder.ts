import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createRunRecorder } from "../dist/trace/run-recorder.js";
import type { WorkflowStage } from "../dist/workflow/stages.js";

export default function (pi: ExtensionAPI) {
  pi.on("tool_execution_end", async (e, ctx) => {
    const taskId =
      (globalThis as any).__issuepilot_task_id ||
      process.env.ISSUEPILOT_TASK_ID ||
      "default";
    const stage = ((globalThis as any).__issuepilot_stage ||
      "understand") as WorkflowStage;
    const recorder = createRunRecorder(ctx.cwd, taskId);

    let detailPath: string | undefined;
    const rawOut = String((e as any).result ?? (e as any).output ?? "");
    if (rawOut.length > 2000) {
      detailPath = recorder.writeDetail(`${e.toolName}-out`, rawOut);
    }

    recorder.append({
      stage,
      eventType: "tool_result",
      toolName: e.toolName,
      success: !e.isError,
      summary: e.isError ? "tool error" : "tool ok",
      errorCode: e.isError ? "TOOL_ERROR" : undefined,
      detailPath,
    });
  });
}
