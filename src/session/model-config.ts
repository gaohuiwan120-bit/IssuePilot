import { loadDotEnv, maskSecret } from "../config/load-env.js";

export type IssuePilotProvider = "mock" | "deepseek";

export interface ModelConfig {
  provider: IssuePilotProvider;
  model: string;
  /** Present only when provider needs a live key; never log this field. */
  apiKey?: string;
  apiKeyPresent: boolean;
  baseUrl?: string;
}

export class ModelConfigError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ModelConfigError";
    this.code = code;
  }
}

export interface ResolveModelOptions {
  cwd?: string;
  provider?: string;
  model?: string;
  /** When true, missing DeepSeek key throws. Mock never throws for keys. */
  requireLiveKey?: boolean;
}

export function resolveModelConfig(opts: ResolveModelOptions = {}): ModelConfig {
  loadDotEnv(opts.cwd ?? process.cwd());
  const providerRaw = (opts.provider || process.env.ISSUEPILOT_PROVIDER || "mock").toLowerCase();
  const provider: IssuePilotProvider =
    providerRaw === "deepseek" ? "deepseek" : providerRaw === "mock" ? "mock" : "mock";

  if (opts.provider && !["mock", "deepseek"].includes(opts.provider.toLowerCase())) {
    throw new ModelConfigError(
      "UNSUPPORTED_PROVIDER",
      `Unsupported provider "${opts.provider}". Supported: mock, deepseek`,
    );
  }

  const model =
    opts.model ||
    process.env.ISSUEPILOT_MODEL ||
    (provider === "deepseek" ? "deepseek-chat" : "mock-issuepilot");

  if (provider === "mock") {
    return {
      provider: "mock",
      model,
      apiKeyPresent: false,
    };
  }

  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  const requireLive = opts.requireLiveKey !== false;
  if (!apiKey) {
    if (requireLive) {
      throw new ModelConfigError(
        "MISSING_API_KEY",
        "DEEPSEEK_API_KEY is missing. Set it in the environment or IssuePilot .env (see .env.example). Refusing to invent results.",
      );
    }
    return {
      provider: "deepseek",
      model,
      apiKeyPresent: false,
      baseUrl: "https://api.deepseek.com",
    };
  }

  return {
    provider: "deepseek",
    model,
    apiKey,
    apiKeyPresent: true,
    baseUrl: "https://api.deepseek.com",
  };
}

export function modelConfigPublicSummary(cfg: ModelConfig): Record<string, string> {
  return {
    provider: cfg.provider,
    model: cfg.model,
    apiKey: cfg.apiKeyPresent ? maskSecret(cfg.apiKey) : "(not required / missing)",
  };
}
