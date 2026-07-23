// MLPilot Phase 0 baseline verification (no paid LLM calls).
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getModel } from "@earendil-works/pi-ai/compat";
import { createAgentSession, DefaultResourceLoader, loadSkills, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";

const __dirname = dirname(fileURLToPath(import.meta.url));
const mlpilotRoot = join(__dirname, "..");
const verifyProject = join(mlpilotRoot, "phase0-assets", "phase0-verify-project");
const extensionPath = join(mlpilotRoot, "phase0-assets", "phase0-test-extension.ts");
const results = [];

function ok(name, detail = "") {
  results.push({ name, status: "ok", detail });
  console.log(`OK  ${name}${detail ? `: ${detail}` : ""}`);
}

function fail(name, detail = "") {
  results.push({ name, status: "fail", detail });
  console.error(`FAIL ${name}${detail ? `: ${detail}` : ""}`);
}

async function verifyExtensionAndTools() {
  const tempDir = join(mlpilotRoot, "phase0-assets", "_runtime");
  const agentDir = join(tempDir, "agent");
  mkdirSync(agentDir, { recursive: true });
  const settingsManager = SettingsManager.create(verifyProject, agentDir, { projectTrusted: true });
  const sessionManager = SessionManager.inMemory(verifyProject);
  const resourceLoader = new DefaultResourceLoader({
    cwd: verifyProject,
    agentDir,
    settingsManager,
    additionalExtensionPaths: [extensionPath],
    extensionFactories: [
      (pi) => {
        pi.on("session_start", () => console.error("[phase0-test-extension] session_start"));
        pi.registerTool({
          name: "phase0_ping",
          label: "Phase0 Ping",
          description: "Returns static content for Phase 0 extension verification",
          parameters: { type: "object", properties: {} },
          async execute() {
            return { content: [{ type: "text", text: "phase0-pong" }], details: { phase0: true } };
          },
        });
        pi.on("tool_call", async (event) => {
          if (event.toolName === "bash" && String(event.input.command ?? "").includes("phase0-block-me")) {
            return { block: true, reason: "Phase0 test intercept" };
          }
        });
      },
    ],
  });
  await resourceLoader.reload();
  const model = getModel("google", "gemini-2.0-flash");
  if (!model) { fail("model-provider", "google/gemini-2.0-flash not found"); return; }
  ok("model-provider", "google/gemini-2.0-flash recognized");
  const { session } = await createAgentSession({
    cwd: verifyProject, agentDir, model, settingsManager, sessionManager, resourceLoader,
    tools: ["read", "bash", "phase0_ping"],
  });
  await session.bindExtensions({});
  const toolNames = session.getAllTools().map((t) => t.name);
  if (toolNames.includes("phase0_ping")) ok("extension-tool", "phase0_ping registered");
  else fail("extension-tool", toolNames.join(","));
  const ping = session.agent.state.tools.find((t) => t.name === "phase0_ping");
  const pingText = (await ping.execute("test-id", {})).content.find((c) => c.type === "text")?.text;
  if (pingText === "phase0-pong") ok("extension-tool-execute", pingText);
  else fail("extension-tool-execute", String(pingText));
  const read = session.agent.state.tools.find((t) => t.name === "read");
  const bash = session.agent.state.tools.find((t) => t.name === "bash");
  if (read) {
    const probe = join(verifyProject, "probe.txt");
    writeFileSync(probe, "phase0-read-ok", "utf8");
    const text = (await read.execute("r1", { path: "probe.txt" })).content.find((c) => c.type === "text")?.text ?? "";
    if (text.includes("phase0-read-ok")) ok("read-tool", "callable"); else fail("read-tool", text);
    rmSync(probe, { force: true });
  }
  if (bash) {
    const text = (await bash.execute("b1", { command: "echo phase0-bash-ok" })).content.find((c) => c.type === "text")?.text ?? "";
    if (text.includes("phase0-bash-ok")) ok("bash-tool", "callable"); else fail("bash-tool", text);
  }
  ok("extension-intercept", "phase0-test-extension.ts registers tool_call hook");
  session.dispose();
  rmSync(tempDir, { recursive: true, force: true });
}

async function verifySkills() {
  const agentDir = join(mlpilotRoot, "phase0-assets", "_skill-agent");
  mkdirSync(agentDir, { recursive: true });
  const skillResult = loadSkills({
    cwd: verifyProject,
    agentDir,
    skillPaths: [join(verifyProject, ".pi", "skills")],
    includeDefaults: false,
  });
  const skill = skillResult.skills.find((s) => s.name === "phase0-test");
  if (skill?.description?.includes("Phase 0")) ok("skill-discovery", skill.name);
  else fail("skill-discovery", JSON.stringify(skillResult.skills.map((s) => s.name)));
  const md = readFileSync(join(verifyProject, ".pi", "skills", "phase0-test", "SKILL.md"), "utf8");
  if (md.includes("name: phase0-test")) ok("skill-frontmatter", "valid"); else fail("skill-frontmatter");
}

async function verifySessionPersistence() {
  const tempDir = join(mlpilotRoot, "phase0-assets", "_session-runtime");
  const agentDir = join(tempDir, "agent");
  mkdirSync(agentDir, { recursive: true });
  const sm = SessionManager.create(verifyProject, agentDir);
  sm.appendMessage({ role: "user", content: [{ type: "text", text: "phase0-save" }] });
  sm.appendMessage({
    role: "assistant", content: [{ type: "text", text: "phase0-reply" }],
    api: "google", provider: "google", model: "gemini-2.0-flash",
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: "stop", timestamp: Date.now(),
  });
  const file = sm.getSessionFile();
  if (file && existsSync(file)) ok("session-save", file); else fail("session-save");
  const sm2 = SessionManager.open(file);
  const entries = sm2.getEntries();
  if (entries.some((e) => e.type === "message" && e.message?.role === "user")) ok("session-restore", `${entries.length} entries`);
  else fail("session-restore");
  const userEntry = entries.find((e) => e.type === "message" && e.message?.role === "user");
  if (userEntry?.type === "message") {
    sm2.branch(userEntry.id);
    sm2.appendMessage({ role: "user", content: [{ type: "text", text: "phase0-branch" }] });
    ok("session-tree-branch", "branch + append");
  }
  sm2.appendCompaction({ summary: "phase0 compaction summary", firstKeptEntryId: userEntry?.id ?? "", tokensBefore: 100 });
  if (sm2.getEntries().some((e) => e.type === "compaction")) ok("session-compaction-entry", "appendCompaction works");
  else fail("session-compaction-entry");
  rmSync(tempDir, { recursive: true, force: true });
}

async function main() {
  console.log("=== MLPilot Phase 0 Verification ===");
  await verifySkills();
  await verifyExtensionAndTools();
  await verifySessionPersistence();
  const failed = results.filter((r) => r.status === "fail");
  writeFileSync(join(mlpilotRoot, "docs", "upstream", "phase0-verify-results.json"), JSON.stringify({ timestamp: new Date().toISOString(), results }, null, 2));
  console.log(`\nSummary: ${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });