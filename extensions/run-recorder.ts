import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

function tracePath(cwd: string, taskId: string) {
  const d = join(cwd, "outputs", taskId);
  mkdirSync(d, { recursive: true });
  return join(d, "run_trace.jsonl");
}

export default function (pi: ExtensionAPI) {
  pi.on("tool_execution_end", async (e, ctx) => {
    const taskId =
      (globalThis as any).__issuepilot_task_id ||
      process.env.ISSUEPILOT_TASK_ID ||
      "default";
    appendFileSync(
      tracePath(ctx.cwd, taskId),
      JSON.stringify({ t: Date.now(), tool: e.toolName, error: e.isError }) + "\n",
    );
  });
}
