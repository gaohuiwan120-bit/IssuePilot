import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  lstatSync,
} from "node:fs";
import { join, relative, sep } from "node:path";
import type { RepositoryInventory } from "../schema/types.js";
import { inspectGitRepo } from "../git/checkpoint.js";
import { ToolRuntime, isSkippedDirName, SENSITIVE_NAME_RE } from "./context.js";
import { IssueToolError } from "./errors.js";

export interface InspectRepositoryInput {
  taskId: string;
  repositoryPath: string;
  maxFiles?: number;
  maxFileBytes?: number;
}

export function inspectRepository(input: InspectRepositoryInput): RepositoryInventory {
  const started = Date.now();
  const runtime = new ToolRuntime(input.taskId, input.repositoryPath, {
    stage: "inspect",
    maxFiles: input.maxFiles,
    maxFileBytes: input.maxFileBytes,
  });
  try {
    const root = runtime.repositoryPath;
    let fileCount = 0;
    const files: string[] = [];

    walk(root, root, runtime.maxFiles, (abs, rel) => {
      if (SENSITIVE_NAME_RE.test(abs) || SENSITIVE_NAME_RE.test(rel)) return;
      fileCount += 1;
      if (fileCount > runtime.maxFiles) {
        throw new IssueToolError("FILE_LIMIT_EXCEEDED", `file limit ${runtime.maxFiles}`);
      }
      files.push(rel);
    });

    const has = (name: string) => files.some((f) => f === name || f.endsWith("/" + name));
    const hasPrefix = (p: string) => files.some((f) => f === p || f.startsWith(p + "/"));

    const languages: string[] = [];
    if (files.some((f) => /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(f))) languages.push("javascript/typescript");
    if (files.some((f) => f.endsWith(".py"))) languages.push("python");

    const packageManagers: string[] = [];
    if (has("package-lock.json")) packageManagers.push("npm");
    if (has("pnpm-lock.yaml")) packageManagers.push("pnpm");
    if (has("yarn.lock")) packageManagers.push("yarn");
    if (has("poetry.lock") || has("pyproject.toml")) packageManagers.push("poetry/pip");
    if (has("requirements.txt")) packageManagers.push("pip");

    const frameworks: string[] = [];
    let pkg: Record<string, unknown> | null = null;
    if (has("package.json")) {
      pkg = readJsonLimited(join(root, "package.json"), runtime.maxFileBytes);
      const deps = {
        ...(pkg?.dependencies as object),
        ...(pkg?.devDependencies as object),
      } as Record<string, string>;
      if (deps.react || deps.next) frameworks.push("react");
      if (deps.express || deps.fastify || deps.koa) frameworks.push("node-http");
      if (deps.vitest) frameworks.push("vitest");
      if (deps.jest) frameworks.push("jest");
      if (deps.typescript || has("tsconfig.json")) frameworks.push("typescript");
    }
    if (has("pytest.ini") || files.some((f) => /(?:^|\/)tests?\/.*\.py$/.test(f))) {
      frameworks.push("pytest");
    }
    if (has("pyproject.toml")) frameworks.push("python-packaging");

    const entryPoints: string[] = [];
    if (pkg?.main && typeof pkg.main === "string") entryPoints.push(pkg.main);
    for (const candidate of ["src/index.ts", "src/index.js", "index.ts", "index.js", "main.py", "src/main.py"]) {
      if (has(candidate) && !entryPoints.includes(candidate)) entryPoints.push(candidate);
    }

    const sourceDirectories = ["src", "lib", "app"].filter((d) => hasPrefix(d));
    const testDirectories = ["test", "tests", "__tests__", "spec"].filter((d) => hasPrefix(d));

    const buildCommands: string[] = [];
    const testCommands: string[] = [];
    const lintCommands: string[] = [];
    if (pkg?.scripts && typeof pkg.scripts === "object") {
      const scripts = pkg.scripts as Record<string, string>;
      if (scripts.build) buildCommands.push("npm run build");
      if (scripts.test) testCommands.push("npm test");
      if (scripts.lint) lintCommands.push("npm run lint");
      if (scripts.typecheck) buildCommands.push("npm run typecheck");
    }
    if (has("pytest.ini") || testDirectories.includes("tests")) {
      if (!testCommands.includes("pytest")) testCommands.push("pytest");
    }
    if (has("tsconfig.json") && !buildCommands.includes("tsc -p tsconfig.json")) {
      // discover only; do not invent as mandatory
    }

    const git = inspectGitRepo(root);
    const gitStatus = git.isGitRepo
      ? `branch=${git.currentBranch ?? "detached"} dirty=${git.dirty} head=${git.headCommit?.slice(0, 8) ?? "none"}`
      : "not-a-git-repository";

    let projectType = "unknown";
    if (languages.includes("javascript/typescript") && languages.includes("python")) {
      projectType = "mixed-node-python";
    } else if (languages.includes("javascript/typescript")) {
      projectType = "node";
    } else if (languages.includes("python")) {
      projectType = "python";
    } else if (files.length === 0) {
      projectType = "empty";
    }

    const inventory: RepositoryInventory = {
      taskId: input.taskId,
      projectType,
      languages,
      frameworks: unique(frameworks),
      packageManagers: unique(packageManagers),
      entryPoints,
      sourceDirectories,
      testDirectories,
      buildCommands,
      testCommands,
      lintCommands,
      gitStatus,
    };

    runtime.store.writeJson("repository_inventory.json", inventory);
    runtime.trace("inspect_repository", true, `type=${projectType} files=${files.length}`, {
      durationMs: Date.now() - started,
    });
    return inventory;
  } catch (e) {
    runtime.trace("inspect_repository", false, e instanceof Error ? e.message : String(e), {
      errorCode: e instanceof IssueToolError ? e.code : "INVALID_REPOSITORY_PATH",
      durationMs: Date.now() - started,
    });
    throw e;
  }
}

function walk(
  root: string,
  dir: string,
  maxFiles: number,
  onFile: (abs: string, rel: string) => void,
): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    if (isSkippedDirName(ent.name)) continue;
    const abs = join(dir, ent.name);
    const rel = relative(root, abs).split(sep).join("/");
    try {
      if (ent.isSymbolicLink()) {
        // resolve via runtime checks: skip outbound links
        const st = lstatSync(abs);
        if (st.isSymbolicLink()) {
          // do not follow directory symlinks
          continue;
        }
      }
      if (ent.isDirectory()) {
        walk(root, abs, maxFiles, onFile);
      } else if (ent.isFile()) {
        onFile(abs, rel);
      }
    } catch (e) {
      if (e instanceof IssueToolError) throw e;
      /* skip unreadable */
    }
  }
}

function readJsonLimited(path: string, maxBytes: number): Record<string, unknown> | null {
  try {
    const st = statSync(path);
    if (st.size > maxBytes) {
      throw new IssueToolError("READ_LIMIT_EXCEEDED", `file too large: ${path}`);
    }
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch (e) {
    if (e instanceof IssueToolError) throw e;
    return null;
  }
}

function unique(xs: string[]): string[] {
  return [...new Set(xs)];
}
