import { readFileSync } from "node:fs";
export function loadConfig(path) {
  const cfg = JSON.parse(readFileSync(path, "utf8"));
  // BUG: missing validation for maxRetries
  return cfg;
}
