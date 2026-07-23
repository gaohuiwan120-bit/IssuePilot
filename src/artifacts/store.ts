import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import {
  ARTIFACT_NAMES,
  assertValidTaskId,
  isArtifactName,
  type ArtifactName,
} from "./names.js";

export {
  ARTIFACT_NAMES,
  OPTIONAL_ARTIFACTS,
  REQUIRED_ARTIFACTS,
  assertValidTaskId,
  isArtifactName,
  isOptionalArtifact,
  type ArtifactName,
} from "./names.js";

export class ArtifactError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArtifactError";
  }
}

export class ArtifactStore {
  readonly outputsRoot: string;
  readonly taskId: string;
  readonly root: string;

  constructor(outputsRoot: string, taskId: string) {
    assertValidTaskId(taskId);
    this.outputsRoot = resolve(outputsRoot);
    this.taskId = taskId;
    this.root = resolve(join(this.outputsRoot, taskId));
    this.assertInsideOutputsRoot(this.root);
    mkdirSync(this.root, { recursive: true });
  }

  path(name: ArtifactName): string {
    if (!isArtifactName(name)) {
      throw new ArtifactError(`unknown artifact name: ${String(name)}`);
    }
    const full = resolve(join(this.root, name));
    this.assertInsideTaskRoot(full);
    return full;
  }

  has(name: ArtifactName): boolean {
    return existsSync(this.path(name));
  }

  writeJson(name: ArtifactName, data: unknown): void {
    const target = this.path(name);
    const payload = JSON.stringify(data, null, 2);
    atomicWriteFile(target, payload);
  }

  readJson<T>(name: ArtifactName): T | undefined {
    const p = this.path(name);
    if (!existsSync(p)) return undefined;
    return JSON.parse(readFileSync(p, "utf8")) as T;
  }

  /** Throws if a required artifact is missing. */
  requireJson<T>(name: ArtifactName): T {
    const value = this.readJson<T>(name);
    if (value === undefined) {
      throw new ArtifactError(`missing required artifact: ${name}`);
    }
    return value;
  }

  writeText(name: ArtifactName, text: string): void {
    atomicWriteFile(this.path(name), text);
  }

  readText(name: ArtifactName): string | undefined {
    const p = this.path(name);
    if (!existsSync(p)) return undefined;
    return readFileSync(p, "utf8");
  }

  appendTrace(line: Record<string, unknown>): void {
    const p = this.path("run_trace.jsonl");
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify(line) + "\n", { flag: "a", encoding: "utf8" });
  }

  writePrSummary(md: string): void {
    this.writeText("pr_summary.md", md);
  }

  /** Lists present artifacts; missing optional ones are fine. */
  listPresent(): ArtifactName[] {
    return ARTIFACT_NAMES.filter((n) => this.has(n));
  }

  private assertInsideOutputsRoot(full: string): void {
    if (!isPathInside(this.outputsRoot, full)) {
      throw new ArtifactError(`path escapes outputs root: ${full}`);
    }
  }

  private assertInsideTaskRoot(full: string): void {
    if (!isPathInside(this.root, full)) {
      throw new ArtifactError(`path escapes task directory: ${full}`);
    }
  }
}

function isPathInside(root: string, candidate: string): boolean {
  const r = resolve(root);
  const c = resolve(candidate);
  if (c === r) return true;
  const prefix = r.endsWith(sep) ? r : r + sep;
  return c.startsWith(prefix);
}

export function defaultOutputsRoot(cwd: string): string {
  return join(cwd, "outputs");
}

export function defaultStateDir(cwd: string): string {
  return join(cwd, ".issuepilot");
}

export function createTaskArtifactStore(cwd: string, taskId: string): ArtifactStore {
  return new ArtifactStore(defaultOutputsRoot(cwd), taskId);
}

function atomicWriteFile(target: string, content: string): void {
  mkdirSync(dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(tmp, content, "utf8");
    renameSync(tmp, target);
  } catch (err) {
    try {
      if (existsSync(tmp)) unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    throw err;
  }
}
