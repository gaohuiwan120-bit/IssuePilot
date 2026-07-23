import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const suite = process.argv.includes("--suite")
  ? process.argv[process.argv.indexOf("--suite") + 1]
  : "all";

function load(dir) {
  try {
    return readdirSync(join(ROOT, dir))
      .filter((f) => f.endsWith(".json"))
      .map((f) => JSON.parse(readFileSync(join(ROOT, dir, f), "utf8")));
  } catch {
    return [];
  }
}

const tasks =
  suite === "offline"
    ? load("eval/offline")
    : suite === "e2e"
      ? load("eval/e2e")
      : [...load("eval/offline"), ...load("eval/e2e")];

console.log("IssuePilot Eval:", tasks.length, "tasks, suite:", suite);
if (tasks.length === 0) {
  console.log(
    "Note: ML eval tasks archived under archive/mlpilot/evaluation/; Issue tasks land in M5.",
  );
}
const valid = tasks.filter((t) => t.id && t.prompt && t.rubric).length;
console.log("Schema valid:", valid + "/" + tasks.length);
process.exit(valid === tasks.length ? 0 : 1);
