import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** IssuePilot project root (directory containing package.json). */
export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
