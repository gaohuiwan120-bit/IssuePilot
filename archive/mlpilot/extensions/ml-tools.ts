import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { readdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
export default function(pi: ExtensionAPI) {
  pi.registerTool({ name: "inspect_ml_project", label: "Inspect ML", description: "Scan PyTorch project", parameters: Type.Object({ path: Type.Optional(Type.String()) }),
    async execute(_id, p, _s, _u, ctx) {
      const root = p.path || ctx.cwd; const files = readdirSync(root).filter(f => /\.(py|yaml|yml|txt)$/.test(f));
      const inv = { framework: "unknown" as string, entryPoints: files.filter(f => /train|main/.test(f)), hasRequirements: existsSync(join(root,"requirements.txt")), hasTests: existsSync(join(root,"tests")) };
      for (const f of files.filter(x => x.endsWith(".py")).slice(0,5)) { try { if (readFileSync(join(root,f),"utf8").includes("torch")) inv.framework = "pytorch"; } catch {} }
      return { content: [{ type: "text", text: JSON.stringify(inv, null, 2) }], details: inv };
  }});
  pi.registerTool({ name: "parse_training_log", label: "Parse Log", parameters: Type.Object({ path: Type.String() }),
    async execute(_id, p) { const t = readFileSync(p.path,"utf8"); return { content: [{ type: "text", text: JSON.stringify({ loss: t.split("\n").filter(l=>/loss|epoch/i.test(l)).slice(-10), errors: t.split("\n").filter(l=>/error|nan/i.test(l)) }, null, 2) }], details: {} }; }
  });
  pi.registerTool({ name: "inspect_python_environment", label: "Py Env", parameters: Type.Object({}),
    async execute(_id, _p, _s, _u, ctx) { const r = await pi.exec("python", ["-c", "import sys; print(sys.version)"], { cwd: ctx.cwd }); return { content: [{ type: "text", text: r.stdout }], details: {} }; }
  });
  pi.registerTool({ name: "analyze_tensor_failure", label: "Tensor", parameters: Type.Object({ traceback: Type.String() }),
    async execute(_id, p) { const h: string[] = []; if (/size mismatch/i.test(p.traceback)) h.push("shape mismatch"); if (/dtype/i.test(p.traceback)) h.push("dtype mismatch"); if (/device/i.test(p.traceback)) h.push("device mismatch"); return { content: [{ type: "text", text: JSON.stringify({ hints: h }) }], details: { hints: h } }; }
  });
  pi.registerTool({ name: "analyze_training_instability", label: "Instability", parameters: Type.Object({ logText: Type.String() }),
    async execute(_id, p) { const s: string[] = []; if (/nan/i.test(p.logText)) s.push("NaN"); if (/inf/i.test(p.logText)) s.push("Inf"); if (/grad/i.test(p.logText)) s.push("gradient issue"); return { content: [{ type: "text", text: JSON.stringify({ signals: s }) }], details: { signals: s } }; }
  });
  pi.registerTool({ name: "run_test_suite", label: "Tests", parameters: Type.Object({ path: Type.Optional(Type.String()) }),
    async execute(_id, p, _s, _u, ctx) { const r = await pi.exec("python", ["-m", "pytest", "-q", "--tb=short"], { cwd: p.path || ctx.cwd }); return { content: [{ type: "text", text: r.stdout + r.stderr }], details: { passed: r.exitCode === 0 } }; }
  });
  pi.registerTool({ name: "run_training_smoke_test", label: "Smoke", parameters: Type.Object({ command: Type.Optional(Type.String()) }),
    async execute(_id, p, _s, _u, ctx) { const c = p.command || process.env.MLPILOT_SMOKE_CMD; if (!c) return { content: [{ type: "text", text: "Set MLPILOT_SMOKE_CMD" }], isError: true, details: {} }; const r = await pi.exec("bash", ["-lc", c], { cwd: ctx.cwd }); return { content: [{ type: "text", text: r.stdout + r.stderr }], details: { passed: r.exitCode === 0 } }; }
  });
  pi.registerTool({ name: "generate_validation_report", label: "Report", parameters: Type.Object({ summary: Type.String() }),
    async execute(_id, p, _s, _u, ctx) { const { writeFileSync, mkdirSync } = await import("node:fs"); const { join } = await import("node:path"); const d = join(ctx.cwd, ".mlpilot", "artifacts"); mkdirSync(d, { recursive: true }); writeFileSync(join(d, "final_report.md"), "# MLPilot Report\n\n" + p.summary); return { content: [{ type: "text", text: "Report written" }], details: {} }; }
  });
}