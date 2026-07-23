/**
 * Optional Pi AgentSession bridge for interactive demos.
 * Does not modify Pi upstream. Uses env / runtime API key only.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import {
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { resolveModelConfig, modelConfigPublicSummary, ModelConfigError } from "./model-config.js";

export interface CreateIssueAgentSessionOptions {
  cwd: string;
  provider?: string;
  model?: string;
}

export async function createIssueAgentSession(opts: CreateIssueAgentSessionOptions) {
  const cfg = resolveModelConfig({
    cwd: opts.cwd,
    provider: opts.provider ?? "deepseek",
    model: opts.model,
    requireLiveKey: true,
  });
  if (cfg.provider === "mock") {
    throw new ModelConfigError(
      "MOCK_NOT_FOR_AGENT_SESSION",
      "createIssueAgentSession requires a live provider (deepseek). Use IssueOrchestrator with provider=mock for tests.",
    );
  }
  if (!cfg.apiKey) {
    throw new ModelConfigError("MISSING_API_KEY", "DEEPSEEK_API_KEY is missing.");
  }

  const authStorage = AuthStorage.create();
  authStorage.setRuntimeApiKey("deepseek", cfg.apiKey);
  const modelRegistry = ModelRegistry.create(authStorage);
  const models = modelRegistry.getAvailable();
  const model =
    models.find((m) => m.provider === "deepseek" && (m.id === cfg.model || m.id.includes("chat"))) ??
    models.find((m) => m.provider === "deepseek");
  if (!model) {
    throw new ModelConfigError(
      "MODEL_NOT_FOUND",
      `No DeepSeek model available for id=${cfg.model}. Check /login or DEEPSEEK_API_KEY.`,
    );
  }

  const agentDir = join(homedir(), ".pi", "agent");
  const loader = new DefaultResourceLoader({
    cwd: opts.cwd,
    agentDir,
  });
  await loader.reload();

  const { session } = await createAgentSession({
    cwd: opts.cwd,
    model,
    authStorage,
    modelRegistry,
    sessionManager: SessionManager.inMemory(opts.cwd),
    resourceLoader: loader,
  });

  return {
    session,
    modelSummary: modelConfigPublicSummary(cfg),
  };
}
