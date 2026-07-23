import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  const tags = new Map<string, string>();

  pi.registerCommand("issuepilot-checkpoint", {
    description: "Git stash checkpoint",
    handler: async (_, ctx) => {
      const { stdout } = await pi.exec("git", ["stash", "create"]);
      const ref = stdout.trim();
      const leaf = ctx.sessionManager.getLeafEntry();
      if (ref && leaf) tags.set(leaf.id, ref);
      ctx.ui.notify(
        ref ? "Checkpoint " + ref.slice(0, 8) : "Nothing to checkpoint",
        ref ? "info" : "warning",
      );
    },
  });

  pi.registerCommand("issuepilot-rollback", {
    description: "Rollback checkpoint",
    handler: async (_, ctx) => {
      const ref = [...tags.values()].at(-1);
      if (!ref) return ctx.ui.notify("No checkpoint", "warning");
      await pi.exec("git", ["checkout", "--", "."]);
      await pi.exec("git", ["stash", "apply", ref]);
      ctx.ui.notify("Rolled back", "info");
    },
  });
}
