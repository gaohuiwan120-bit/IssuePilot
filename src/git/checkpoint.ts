import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export type CheckpointStrategy = "branch" | "worktree" | "patch-only";

export interface GitRepoStatus {
  isGitRepo: boolean;
  repositoryRoot: string | null;
  currentBranch: string | null;
  headCommit: string | null;
  dirty: boolean;
  untracked: string[];
  modified: string[];
  detachedHead: boolean;
  mergeInProgress: boolean;
  rebaseInProgress: boolean;
}

export interface GitCheckpoint {
  taskId: string;
  repositoryRoot: string;
  baseCommit: string;
  originalBranch: string;
  repairBranch: string | null;
  worktreePath: string | null;
  dirtyBeforeStart: boolean;
  preexistingModifiedFiles: string[];
  createdAt: string;
  strategy: CheckpointStrategy;
}

export interface CheckpointCreateOptions {
  taskId: string;
  cwd: string;
  strategy?: CheckpointStrategy;
  /** Allow dirty worktree only when explicitly approved. */
  allowDirty?: boolean;
  /** Dry-run: validate and return plan without mutating git. */
  dryRun?: boolean;
  /** Forbidden repository roots (e.g. pi-upstream). */
  forbiddenRoots?: string[];
  repairBranchName?: string;
}

export interface CheckpointResult {
  ok: boolean;
  checkpoint?: GitCheckpoint;
  status: GitRepoStatus;
  reason?: string;
  rollbackPlan?: string[];
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function tryGit(cwd: string, args: string[]): string | null {
  try {
    return git(cwd, args);
  } catch {
    return null;
  }
}

export function inspectGitRepo(cwd: string): GitRepoStatus {
  const root = tryGit(cwd, ["rev-parse", "--show-toplevel"]);
  if (!root) {
    return {
      isGitRepo: false,
      repositoryRoot: null,
      currentBranch: null,
      headCommit: null,
      dirty: false,
      untracked: [],
      modified: [],
      detachedHead: false,
      mergeInProgress: false,
      rebaseInProgress: false,
    };
  }
  const headCommit = tryGit(root, ["rev-parse", "HEAD"]);
  const branch = tryGit(root, ["branch", "--show-current"]) || "";
  const detachedHead = !branch;
  const porcelain = tryGit(root, ["status", "--porcelain"]) || "";
  const lines = porcelain ? porcelain.split("\n").filter(Boolean) : [];
  const untracked: string[] = [];
  const modified: string[] = [];
  for (const line of lines) {
    const path = line.slice(3);
    if (line.startsWith("??")) untracked.push(path);
    else modified.push(path);
  }
  const mergeInProgress =
    existsSync(join(root, ".git", "MERGE_HEAD")) ||
    existsSync(join(root, ".git", "MERGE_MSG"));
  const rebaseInProgress =
    existsSync(join(root, ".git", "rebase-merge")) ||
    existsSync(join(root, ".git", "rebase-apply"));

  return {
    isGitRepo: true,
    repositoryRoot: root,
    currentBranch: branch || null,
    headCommit,
    dirty: lines.length > 0,
    untracked,
    modified,
    detachedHead,
    mergeInProgress,
    rebaseInProgress,
  };
}

export function isValidRepairBranchName(name: string): boolean {
  if (!name || name.length > 120) return false;
  if (name.startsWith("-") || name.endsWith(".") || name.includes("..")) return false;
  if (name.includes(" ") || name.includes("\\") || name.includes("~") || name.includes("^")) {
    return false;
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(name)) return false;
  if (name.includes("//")) return false;
  return true;
}

function assertNotForbidden(root: string, forbiddenRoots: string[] = []): void {
  const resolved = resolve(root);
  for (const f of forbiddenRoots) {
    const fr = resolve(f);
    if (resolved === fr || resolved.startsWith(fr + "\\") || resolved.startsWith(fr + "/")) {
      throw new Error(`refusing to operate on forbidden repository: ${fr}`);
    }
  }
}

/**
 * Create a safe checkpoint. Never runs reset --hard or clean.
 * Default: stop on dirty worktree unless allowDirty=true.
 */
export function createGitCheckpoint(opts: CheckpointCreateOptions): CheckpointResult {
  const status = inspectGitRepo(opts.cwd);
  if (!status.isGitRepo || !status.repositoryRoot || !status.headCommit) {
    return { ok: false, status, reason: "not a git repository" };
  }
  try {
    assertNotForbidden(status.repositoryRoot, opts.forbiddenRoots);
  } catch (e) {
    return { ok: false, status, reason: String(e) };
  }
  if (status.detachedHead) {
    return { ok: false, status, reason: "detached HEAD is not supported" };
  }
  if (status.mergeInProgress || status.rebaseInProgress) {
    return { ok: false, status, reason: "merge/rebase in progress" };
  }
  if (status.dirty && !opts.allowDirty) {
    return {
      ok: false,
      status,
      reason: "working tree is dirty; refusing to overwrite user changes",
      rollbackPlan: ["Do not reset --hard", "Ask user to commit/stash manually"],
    };
  }

  const strategy: CheckpointStrategy = opts.strategy ?? "branch";
  const repairBranch =
    opts.repairBranchName ??
    `issuepilot/repair/${opts.taskId}`.replace(/[^A-Za-z0-9._/-]+/g, "-");
  if (!isValidRepairBranchName(repairBranch)) {
    return { ok: false, status, reason: `invalid repair branch name: ${repairBranch}` };
  }

  const checkpoint: GitCheckpoint = {
    taskId: opts.taskId,
    repositoryRoot: status.repositoryRoot,
    baseCommit: status.headCommit,
    originalBranch: status.currentBranch || "HEAD",
    repairBranch: strategy === "patch-only" ? null : repairBranch,
    worktreePath: null,
    dirtyBeforeStart: status.dirty,
    preexistingModifiedFiles: [...status.modified, ...status.untracked],
    createdAt: new Date().toISOString(),
    strategy,
  };

  const rollbackPlan = [
    `git switch ${checkpoint.originalBranch}`,
    checkpoint.repairBranch ? `git branch -D ${checkpoint.repairBranch}` : "(no repair branch)",
    "Never use git reset --hard automatically",
  ];

  if (opts.dryRun) {
    return { ok: true, checkpoint, status, rollbackPlan };
  }

  // Mutating path: create branch only (no hard reset / clean / auto-commit of user files)
  if (strategy === "branch" || strategy === "worktree") {
    try {
      git(status.repositoryRoot, ["branch", repairBranch, "HEAD"]);
      if (strategy === "worktree") {
        const wt = join(status.repositoryRoot, ".issuepilot", "worktrees", opts.taskId);
        mkdirSync(join(status.repositoryRoot, ".issuepilot", "worktrees"), { recursive: true });
        if (!existsSync(wt)) {
          git(status.repositoryRoot, ["worktree", "add", wt, repairBranch]);
        }
        checkpoint.worktreePath = wt;
      }
    } catch (e) {
      return { ok: false, status, reason: `failed to create branch/worktree: ${String(e)}` };
    }
  }

  // Always save a pre-start patch snapshot when dirty was allowed
  if (status.dirty && opts.allowDirty) {
    const patchDir = join(status.repositoryRoot, ".issuepilot", "checkpoints", opts.taskId);
    mkdirSync(patchDir, { recursive: true });
    const patch = tryGit(status.repositoryRoot, ["diff"]) || "";
    writeFileSync(join(patchDir, "preexisting.patch"), patch, "utf8");
  }

  return { ok: true, checkpoint, status, rollbackPlan };
}

export function collectDiffSummary(cwd: string): {
  ok: boolean;
  patch: string;
  modifiedFiles: string[];
  reason?: string;
} {
  const status = inspectGitRepo(cwd);
  if (!status.isGitRepo || !status.repositoryRoot) {
    return { ok: false, patch: "", modifiedFiles: [], reason: "not a git repository" };
  }
  const patch = tryGit(status.repositoryRoot, ["diff"]) || "";
  const names = tryGit(status.repositoryRoot, ["diff", "--name-only"]) || "";
  return {
    ok: true,
    patch,
    modifiedFiles: names ? names.split("\n").filter(Boolean) : [],
  };
}

/** Dry-run rollback plan only — does not mutate. */
export function planRollback(checkpoint: GitCheckpoint): string[] {
  return [
    `Verify user worktree state before any restore`,
    `Optional: git switch ${checkpoint.originalBranch}`,
    checkpoint.repairBranch
      ? `Optional: delete repair branch ${checkpoint.repairBranch} after review`
      : "No repair branch to delete",
    `Restore from base commit ${checkpoint.baseCommit} only with explicit user approval`,
    `Forbidden: git reset --hard / git clean -fd without explicit approval`,
  ];
}
