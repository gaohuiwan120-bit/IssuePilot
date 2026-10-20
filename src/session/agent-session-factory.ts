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
  /** When set, this session file is the only model context. */
  sessionManager?: SessionManager;
}

interface IssueAgentRuntime {
  model: NonNullable<Awaited<ReturnType<typeof createAgentSession>>["session"]["model"]>;
  authStorage: AuthStorage;
  modelRegistry: ModelRegistry;
  loader: DefaultResourceLoader;
  modelSummary: Record<string, string>;
}

const runtimes = new Map<string, Promise<IssueAgentRuntime>>();

export function getIssueAgentRuntime(opts: Omit<CreateIssueAgentSessionOptions, "sessionManager">): Promise<IssueAgentRuntime> {
  const key = `${opts.cwd}\n${opts.provider ?? "deepseek"}\n${opts.model ?? ""}`;
  const existing = runtimes.get(key);
  if (existing) return existing;
  const created = loadIssueAgentRuntime(opts).catch((error) => {
    runtimes.delete(key);
    throw error;
  });
  runtimes.set(key, created);
  return created;
}

async function loadIssueAgentRuntime(opts: Omit<CreateIssueAgentSessionOptions, "sessionManager">): Promise<IssueAgentRuntime> {
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
  return {
    model,
    authStorage,
    modelRegistry,
    loader,
    modelSummary: modelConfigPublicSummary(cfg),
  };
}

export async function createIssueAgentSession(opts: CreateIssueAgentSessionOptions) {
  const runtime = await getIssueAgentRuntime(opts);
  const { session } = await createAgentSession({
    cwd: opts.cwd,
    model: runtime.model,
    authStorage: runtime.authStorage,
    modelRegistry: runtime.modelRegistry,
    sessionManager: opts.sessionManager ?? SessionManager.inMemory(opts.cwd),
    resourceLoader: runtime.loader,
  });

  return {
    session,
    modelSummary: runtime.modelSummary,
  };
}
