import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "run_in_docker",
    label: "Docker",
    description: "Run command in IssuePilot sandbox container",
    parameters: Type.Object({ command: Type.String() }),
    async execute(_id, params, _s, _u, ctx) {
      const img = process.env.ISSUEPILOT_DOCKER_IMAGE || "issuepilot-pi-sandbox";
      try {
        const r = await pi.exec("docker", [
          "run",
          "--rm",
          "-v",
          ctx.cwd + ":/workspace",
          "-w",
          "/workspace",
          img,
          "bash",
          "-lc",
          params.command,
        ]);
        return {
          content: [{ type: "text", text: r.stdout || r.stderr }],
          details: { exitCode: r.exitCode },
        };
      } catch (e) {
        return {
          content: [{ type: "text", text: String(e) }],
          isError: true,
          details: {},
        };
      }
    },
  });
}
