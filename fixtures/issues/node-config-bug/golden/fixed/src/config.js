import { readFileSync } from "node:fs";
export function loadConfig(path) {
  const cfg = JSON.parse(readFileSync(path, "utf8"));
  if (cfg.maxRetries === undefined || cfg.maxRetries === null) throw new Error("CONFIG_MISSING");
  return cfg;
}
