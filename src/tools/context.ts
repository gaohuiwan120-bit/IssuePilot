import { resolve, normalize, isAbsolute, sep, relative } from "node:path";
import { realpathSync, existsSync, lstatSync, readlinkSync } from "node:fs";
import { assertValidTaskId } from "../artifacts/names.js";
import { ArtifactStore, defaultOutputsRoot } from "../artifacts/store.js";
import { RunRecorder } from "../trace/run-recorder.js";
import type { WorkflowStage } from "../workflow/stages.js";
import { IssueToolError } from "./errors.js";

export const DEFAULT_SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  ".next",
  ".turbo",
  "__pycache__",
  ".venv",
  "venv",
  ".issuepilot",
  "outputs",
]);

export const SENSITIVE_NAME_RE =
  /(^|[/\\])(\.env(\..+)?|.*\.(pem|key|p12|pfx)|id_rsa|id_ed25519|credentials\.json|auth\.json|secrets?\.(json|ya?ml))([/\\]|$)/i;

export interface ToolRuntimeOptions {
  outputsRoot?: string;
  stage?: WorkflowStage;
  maxFiles?: number;
  maxFileBytes?: number;
}

export class ToolRuntime {
  readonly taskId: string;
  readonly repositoryPath: string;
  readonly outputsRoot: string;
  readonly store: ArtifactStore;
  readonly recorder: RunRecorder;
  readonly stage: WorkflowStage;
  readonly maxFiles: number;
  readonly maxFileBytes: number;

  constructor(taskId: string, repositoryPath: string, opts: ToolRuntimeOptions = {}) {
    try {
      assertValidTaskId(taskId);
    } catch {
      throw new IssueToolError("INVALID_TASK_ID", `invalid taskId: ${taskId}`);
    }
    const abs = resolve(repositoryPath);
    if (!existsSync(abs) || !lstatSync(abs).isDirectory()) {
      throw new IssueToolError("INVALID_REPOSITORY_PATH", `not a directory: ${abs}`);
    }
    this.taskId = taskId;
    this.repositoryPath = abs;
    this.outputsRoot = opts.outputsRoot ?? defaultOutputsRoot(abs);
    this.store = new ArtifactStore(this.outputsRoot, taskId);
    this.recorder = new RunRecorder(this.outputsRoot, taskId);
    this.stage = opts.stage ?? "understand";
    this.maxFiles = opts.maxFiles ?? 5000;
    this.maxFileBytes = opts.maxFileBytes ?? 512_000;
  }

  resolveInside(candidate: string): string {
    if (candidate.includes("\0") || hasTraversal(candidate)) {
      throw new IssueToolError("PATH_OUTSIDE_REPOSITORY", `path traversal: ${candidate}`);
    }
    const abs = isAbsolute(candidate) ? resolve(candidate) : resolve(this.repositoryPath, candidate);
    if (!isInside(this.repositoryPath, abs)) {
      throw new IssueToolError("PATH_OUTSIDE_REPOSITORY", `outside repository: ${candidate}`);
    }
    if (SENSITIVE_NAME_RE.test(abs)) {
      throw new IssueToolError("SENSITIVE_PATH", `sensitive path blocked: ${candidate}`);
    }
    // Symlink escape check
    if (existsSync(abs)) {
      try {
        const real = realpathSync(abs);
        if (!isInside(this.repositoryPath, real) && !isInside(realpathSync(this.repositoryPath), real)) {
          throw new IssueToolError("PATH_OUTSIDE_REPOSITORY", `symlink escape: ${candidate}`);
        }
      } catch (e) {
        if (e instanceof IssueToolError) throw e;
      }
      try {
        const st = lstatSync(abs);
        if (st.isSymbolicLink()) {
          const target = readlinkSync(abs);
          const resolvedTarget = isAbsolute(target)
            ? resolve(target)
            : resolve(abs, "..", target);
          if (!isInside(this.repositoryPath, resolve(resolvedTarget))) {
            throw new IssueToolError("PATH_OUTSIDE_REPOSITORY", `symlink escape: ${candidate}`);
          }
        }
      } catch (e) {
        if (e instanceof IssueToolError) throw e;
      }
    }
    return abs;
  }

  rel(absPath: string): string {
    return relative(this.repositoryPath, absPath).split(sep).join("/");
  }

  trace(
    toolName: string,
    success: boolean,
    summary: string,
    extra?: { errorCode?: string; durationMs?: number },
  ): void {
    this.recorder.append({
      stage: this.stage,
      eventType: "tool_result",
      toolName,
      success,
      summary,
      errorCode: extra?.errorCode,
      durationMs: extra?.durationMs,
    });
  }
}

export function isInside(root: string, candidate: string): boolean {
  const r = resolve(root);
  const c = resolve(candidate);
  if (c === r) return true;
  const prefix = r.endsWith(sep) ? r : r + sep;
  return c.toLowerCase().startsWith(prefix.toLowerCase());
}

export function hasTraversal(p: string): boolean {
  const n = normalize(p);
  return n.split(/[\\/]/).includes("..");
}

export function isSkippedDirName(name: string): boolean {
  return DEFAULT_SKIP_DIRS.has(name);
}
