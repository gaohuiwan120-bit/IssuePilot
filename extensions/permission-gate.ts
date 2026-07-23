import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const BLOCKED = [/\brm\s+(-rf?|--recursive)/i, /\bsudo\b/i, /git\s+push/i];

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName !== "bash") return;
    const cmd = String(event.input.command ?? "");
    if (BLOCKED.some((p) => p.test(cmd))) {
      if (!ctx.hasUI) return { block: true, reason: "IssuePilot blocked dangerous command" };
      const ok = await ctx.ui.confirm("IssuePilot", "Allow dangerous command?");
      if (!ok) return { block: true, reason: "User blocked" };
    }
  });
}
