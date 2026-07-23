import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

const ROOT = "e:/AgentProject/pi_project/agent-projects/mlpilot/fixtures/issues";

function write(p, c) {
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, c);
}

function initGit(dir) {
  execSync("git init", { cwd: dir, stdio: "ignore" });
  execSync('git config user.email "fixture@issuepilot.local"', { cwd: dir, stdio: "ignore" });
  execSync('git config user.name "IssuePilot Fixture"', { cwd: dir, stdio: "ignore" });
  execSync("git add -A", { cwd: dir, stdio: "ignore" });
  execSync('git commit -m "fixture baseline"', { cwd: dir, stdio: "ignore" });
}

{
  const d = join(ROOT, "node-validation-bug");
  write(
    join(d, "ISSUE.md"),
    `# validateUser throws on empty email

## Description
\`validateUser\` in \`src/validate.js\` accepts empty email.

## Actual Behavior
Empty string returns ok:true

## Expected Behavior
Empty email should return ok:false with error EMAIL_REQUIRED

## Steps to Reproduce
1. Run node test/validate.test.js
2. Observe failure EMAIL_REQUIRED

## Acceptance Criteria
- Empty email rejected
- test/validate.test.js passes
`,
  );
  write(
    join(d, "package.json"),
    JSON.stringify(
      { name: "node-validation-bug", type: "module", scripts: { test: "node test/validate.test.js" } },
      null,
      2,
    ),
  );
  write(
    join(d, "src/validate.js"),
    `export function validateUser(user) {
  if (!user || typeof user !== "object") return { ok: false, error: "INVALID" };
  // BUG: empty string is treated as present
  if (user.email === undefined || user.email === null) return { ok: false, error: "EMAIL_REQUIRED" };
  return { ok: true };
}
`,
  );
  write(
    join(d, "test/validate.test.js"),
    `import { validateUser } from "../src/validate.js";
const r = validateUser({ email: "" });
if (r.ok !== false || r.error !== "EMAIL_REQUIRED") {
  console.error("FAIL validateUser empty email");
  process.exit(1);
}
console.log("PASS validateUser");
`,
  );
  write(
    join(d, "golden/fixed/src/validate.js"),
    `export function validateUser(user) {
  if (!user || typeof user !== "object") return { ok: false, error: "INVALID" };
  if (!user.email || String(user.email).trim() === "") return { ok: false, error: "EMAIL_REQUIRED" };
  return { ok: true };
}
`,
  );
  write(
    join(d, "reproduce.json"),
    JSON.stringify(
      {
        commands: [["node", "test/validate.test.js"]],
        expectedFailure: { exitCode: 1, stderrPattern: "FAIL validateUser" },
      },
      null,
      2,
    ),
  );
  write(
    join(d, "golden/issue_spec.json"),
    JSON.stringify(
      {
        taskId: "fx-node-validation",
        title: "validateUser throws on empty email",
        issueType: "bug",
        expectedBehavior: "Empty email should return ok:false with error EMAIL_REQUIRED",
        actualBehavior: "Empty string returns ok:true",
        mentionedFiles: ["src/validate.js"],
        mentionedSymbols: ["validateUser"],
        missingInformation: [],
      },
      null,
      2,
    ),
  );
  write(
    join(d, "golden/related.json"),
    JSON.stringify([{ filePath: "src/validate.js", symbol: "validateUser" }], null, 2),
  );
  initGit(d);
}

{
  const d = join(ROOT, "node-config-bug");
  write(
    join(d, "ISSUE.md"),
    `# Missing config key maxRetries

## Description
\`loadConfig\` in \`src/config.js\` does not require maxRetries.

## Actual Behavior
Returns config without maxRetries

## Expected Behavior
Throws CONFIG_MISSING when maxRetries absent

## Steps to Reproduce
1. node test/config.test.js

## Acceptance Criteria
- missing maxRetries throws CONFIG_MISSING
`,
  );
  write(
    join(d, "package.json"),
    JSON.stringify(
      { name: "node-config-bug", type: "module", scripts: { test: "node test/config.test.js" } },
      null,
      2,
    ),
  );
  write(join(d, "config/app.json"), JSON.stringify({ host: "localhost" }, null, 2));
  write(
    join(d, "src/config.js"),
    `import { readFileSync } from "node:fs";
export function loadConfig(path) {
  const cfg = JSON.parse(readFileSync(path, "utf8"));
  // BUG: missing validation for maxRetries
  return cfg;
}
`,
  );
  write(
    join(d, "test/config.test.js"),
    `import { loadConfig } from "../src/config.js";
let threw = false;
try {
  loadConfig("config/app.json");
} catch (e) {
  threw = e.message === "CONFIG_MISSING";
}
if (!threw) {
  console.error("FAIL config missing maxRetries");
  process.exit(1);
}
console.log("PASS config");
`,
  );
  write(
    join(d, "golden/fixed/src/config.js"),
    `import { readFileSync } from "node:fs";
export function loadConfig(path) {
  const cfg = JSON.parse(readFileSync(path, "utf8"));
  if (cfg.maxRetries === undefined || cfg.maxRetries === null) throw new Error("CONFIG_MISSING");
  return cfg;
}
`,
  );
  write(
    join(d, "reproduce.json"),
    JSON.stringify(
      {
        commands: [["node", "test/config.test.js"]],
        expectedFailure: { exitCode: 1, stderrPattern: "FAIL config" },
      },
      null,
      2,
    ),
  );
  write(
    join(d, "golden/issue_spec.json"),
    JSON.stringify(
      {
        taskId: "fx-node-config",
        title: "Missing config key maxRetries",
        issueType: "bug",
        mentionedFiles: ["src/config.js"],
        mentionedSymbols: ["loadConfig"],
      },
      null,
      2,
    ),
  );
  initGit(d);
}

{
  const d = join(ROOT, "python-path-bug");
  write(
    join(d, "ISSUE.md"),
    `# resolve_data_path joins incorrectly

## Description
\`resolve_data_path\` in \`app/paths.py\` ignores base.

## Actual Behavior
Returns filename only

## Expected Behavior
Returns base/filename joined path

## Steps to Reproduce
1. python -m pytest -q

## Acceptance Criteria
- joined path includes base
`,
  );
  write(join(d, "requirements.txt"), "pytest==8.3.4\n");
  write(join(d, "pytest.ini"), "[pytest]\n");
  write(join(d, "app/__init__.py"), "");
  write(
    join(d, "app/paths.py"),
    `def resolve_data_path(base, name):
    # BUG: ignores base
    return name
`,
  );
  write(
    join(d, "tests/test_paths.py"),
    `from app.paths import resolve_data_path

def test_resolve_joins():
    p = resolve_data_path("/data", "a.txt").replace("\\\\", "/")
    assert "/data/" in p or p.endswith("data/a.txt")
`,
  );
  write(
    join(d, "golden/fixed/app/paths.py"),
    `import os

def resolve_data_path(base, name):
    return os.path.join(base, name)
`,
  );
  write(
    join(d, "reproduce.json"),
    JSON.stringify(
      {
        commands: [["python", "-m", "pytest", "-q"]],
        expectedFailure: { exitCode: 1, stdoutPattern: "FAILED|failed" },
        image: "issuepilot-python:local",
      },
      null,
      2,
    ),
  );
  write(
    join(d, "golden/issue_spec.json"),
    JSON.stringify(
      {
        taskId: "fx-python-path",
        title: "resolve_data_path joins incorrectly",
        issueType: "bug",
        mentionedFiles: ["app/paths.py"],
        mentionedSymbols: ["resolve_data_path"],
      },
      null,
      2,
    ),
  );
  initGit(d);
}

{
  const d = join(ROOT, "python-exception-bug");
  write(
    join(d, "ISSUE.md"),
    `# parse_int does not handle ValueError

## Description
\`parse_int\` in \`app/parse.py\` crashes on bad input.

## Actual Behavior
Traceback ValueError

## Expected Behavior
Returns None on invalid int

## Steps to Reproduce
1. python -m pytest -q

Stack Trace:
\`\`\`
File "app/parse.py", line 2, in parse_int
    return int(text)
ValueError: invalid literal
\`\`\`
`,
  );
  write(join(d, "requirements.txt"), "pytest==8.3.4\n");
  write(join(d, "app/__init__.py"), "");
  write(
    join(d, "app/parse.py"),
    `def parse_int(text):
    return int(text)
`,
  );
  write(
    join(d, "tests/test_parse.py"),
    `from app.parse import parse_int

def test_parse_bad():
    assert parse_int("abc") is None

def test_parse_ok():
    assert parse_int("3") == 3
`,
  );
  write(
    join(d, "golden/fixed/app/parse.py"),
    `def parse_int(text):
    try:
        return int(text)
    except ValueError:
        return None
`,
  );
  write(
    join(d, "reproduce.json"),
    JSON.stringify(
      {
        commands: [["python", "-m", "pytest", "-q"]],
        expectedFailure: { exitCode: 1, stderrPattern: "ValueError|FAILED" },
        image: "issuepilot-python:local",
      },
      null,
      2,
    ),
  );
  write(
    join(d, "golden/issue_spec.json"),
    JSON.stringify(
      {
        taskId: "fx-python-exception",
        title: "parse_int does not handle ValueError",
        issueType: "bug",
        mentionedFiles: ["app/parse.py"],
        mentionedSymbols: ["parse_int"],
      },
      null,
      2,
    ),
  );
  initGit(d);
}

{
  const d = join(ROOT, "mixed-build-failure");
  write(
    join(d, "ISSUE.md"),
    `# TypeScript build fails on bad type

## Description
\`src/math.ts\` / \`src/math.js\` \`add\` returns wrong type.

## Actual Behavior
tests fail and build exits non-zero

## Expected Behavior
add(1,2)===3 and build succeeds

## Steps to Reproduce
1. node test/math.test.js
2. npm run build
`,
  );
  write(
    join(d, "package.json"),
    JSON.stringify(
      {
        name: "mixed-build-failure",
        type: "module",
        scripts: {
          build: "node -e \"console.error('BUILD_FAIL'); process.exit(1)\"",
          test: "node test/math.test.js",
          lint: "node -e \"console.log('lint ok')\"",
        },
      },
      null,
      2,
    ),
  );
  write(join(d, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, noEmit: true }, include: ["src"] }, null, 2));
  write(
    join(d, "src/math.ts"),
    `export function add(a: number, b: number): string {
  return (a + b) as unknown as string;
}
`,
  );
  write(
    join(d, "src/math.js"),
    `export function add(a, b) {
  return String(a + b); // BUG: should return number
}
`,
  );
  write(
    join(d, "test/math.test.js"),
    `import { add } from "../src/math.js";
if (add(1, 2) !== 3) {
  console.error("FAIL add");
  process.exit(1);
}
console.log("PASS add");
`,
  );
  write(join(d, "tools/check.py"), "print('python side present')\n");
  write(join(d, "requirements.txt"), "# no deps\n");
  write(
    join(d, "golden/fixed/src/math.js"),
    `export function add(a, b) {
  return a + b;
}
`,
  );
  write(
    join(d, "reproduce.json"),
    JSON.stringify(
      {
        commands: [["node", "test/math.test.js"]],
        expectedFailure: { exitCode: 1, stderrPattern: "FAIL add" },
      },
      null,
      2,
    ),
  );
  write(
    join(d, "golden/issue_spec.json"),
    JSON.stringify(
      {
        taskId: "fx-mixed-build",
        title: "TypeScript build fails on bad type",
        issueType: "bug",
        mentionedFiles: ["src/math.ts", "src/math.js"],
        mentionedSymbols: ["add"],
      },
      null,
      2,
    ),
  );
  initGit(d);
}

{
  const d = join(ROOT, "safe-clean-project");
  write(
    join(d, "ISSUE.md"),
    `# Feature: document hello

## Description
Documentation task for hello module.

## Acceptance Criteria
- README mentions hello
`,
  );
  write(
    join(d, "package.json"),
    JSON.stringify(
      {
        name: "safe-clean-project",
        type: "module",
        scripts: {
          test: "node test/hello.test.js",
          build: "node -e \"console.log('build ok')\"",
          lint: "node -e \"console.log('lint ok')\"",
        },
      },
      null,
      2,
    ),
  );
  write(join(d, "src/hello.js"), `export function hello(name) { return "hello " + name; }\n`);
  write(
    join(d, "test/hello.test.js"),
    `import { hello } from "../src/hello.js";
if (hello("x") !== "hello x") {
  console.error("FAIL");
  process.exit(1);
}
console.log("PASS");
`,
  );
  write(join(d, "README.md"), "# safe-clean-project\n\nhello module works.\n");
  write(join(d, ".env.example"), "API_KEY=placeholder\n");
  write(
    join(d, "golden/issue_spec.json"),
    JSON.stringify(
      {
        taskId: "fx-safe-clean",
        title: "Feature: document hello",
        issueType: "documentation",
      },
      null,
      2,
    ),
  );
  write(
    join(d, "reproduce.json"),
    JSON.stringify({ commands: [["node", "test/hello.test.js"]], expectedFailure: { exitCode: 1 } }, null, 2),
  );
  initGit(d);
}

console.log("fixtures created under", ROOT);
