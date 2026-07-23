import { execFileSync } from "node:child_process";
import type { PatchManifest, RepairPlan } from "../schema/types.js";
import { inspectGitRepo } from "../git/checkpoint.js";
import { ToolRuntime, SENSITIVE_NAME_RE } from "./context.js";
import { IssueToolError } from "./errors.js";

export interface CollectGitDiffInput {
  taskId: string;
  repositoryPath: string;
  repairPlan?: RepairPlan | null;
}

export interface CollectGitDiffResult {
  manifest: PatchManifest;
  patchPath: string;
  hasBinaryFiles: boolean;
  hasOutsideRepoPaths: boolean;
  hasLockfileChanges: boolean;
  hasSensitiveFiles: boolean;
  unrelatedFiles: string[];
  diffSummary: string;
}

export function collectGitDiff(input: CollectGitDiffInput): CollectGitDiffResult {
  const started = Date.now();
  const runtime = new ToolRuntime(input.taskId, input.repositoryPath, { stage: "review" });
  try {
    const status = inspectGitRepo(runtime.repositoryPath);
    if (!status.isGitRepo || !status.repositoryRoot) {
      throw new IssueToolError("NOT_A_GIT_REPOSITORY", "not a git repository");
    }
    const root = status.repositoryRoot;

    const nameStatus = git(root, ["diff", "--name-status", "HEAD"]) || "";
    const numstat = git(root, ["diff", "--numstat", "HEAD"]) || "";
    const untracked = git(root, ["ls-files", "--others", "--exclude-standard"]) || "";
    const patch = git(root, ["diff", "HEAD"]) || "";

    const modifiedFiles: string[] = [];
    const createdFiles: string[] = [];
    const deletedFiles: string[] = [];
    let hasBinaryFiles = false;
    let hasOutsideRepoPaths = false;
    let hasLockfileChanges = false;
    let hasSensitiveFiles = false;

    for (const line of nameStatus.split("\n").filter(Boolean)) {
      const statusCode = line[0];
      const file = line.slice(1).trim().split("\t").pop() ?? "";
      if (!file) continue;
      if (file.includes("..") || file.startsWith("/")) hasOutsideRepoPaths = true;
      if (isLockfile(file)) hasLockfileChanges = true;
      if (SENSITIVE_NAME_RE.test(file)) hasSensitiveFiles = true;
      if (statusCode === "A") createdFiles.push(file);
      else if (statusCode === "D") deletedFiles.push(file);
      else modifiedFiles.push(file);
    }

    for (const file of untracked.split("\n").filter(Boolean)) {
      createdFiles.push(file);
      if (isLockfile(file)) hasLockfileChanges = true;
      if (SENSITIVE_NAME_RE.test(file)) hasSensitiveFiles = true;
    }

    // include untracked content in patch artifact as best-effort note
    let fullPatch = patch;
    if (untracked.trim()) {
      fullPatch += `\n# untracked files:\n${untracked}\n`;
    }

    let linesAdded = 0;
    let linesDeleted = 0;
    for (const line of numstat.split("\n").filter(Boolean)) {
      const [a, d, file] = line.split("\t");
      if (a === "-" && d === "-") {
        hasBinaryFiles = true;
        continue;
      }
      linesAdded += Number(a) || 0;
      linesDeleted += Number(d) || 0;
      if (file && SENSITIVE_NAME_RE.test(file)) hasSensitiveFiles = true;
    }

    const planned = new Set(input.repairPlan?.filesToModify ?? []);
    const allFiles = [...new Set([...modifiedFiles, ...createdFiles, ...deletedFiles])];
    const unrelatedFiles =
      planned.size === 0 ? [] : allFiles.filter((f) => !planned.has(f) && !plannedHas(planned, f));

    runtime.store.writeText("patch.diff", fullPatch || "# empty diff\n");
    const patchPath = runtime.store.path("patch.diff");

    const manifest: PatchManifest = {
      taskId: input.taskId,
      baseCommit: status.headCommit,
      branch: status.currentBranch,
      worktree: null,
      modifiedFiles,
      createdFiles,
      deletedFiles,
      linesAdded,
      linesDeleted,
      patchPath: `outputs/${input.taskId}/patch.diff`,
    };
    runtime.store.writeJson("patch_manifest.json", manifest);

    const diffSummary = `files=${allFiles.length} +${linesAdded}/-${linesDeleted} binary=${hasBinaryFiles} lockfile=${hasLockfileChanges} sensitive=${hasSensitiveFiles}`;
    const result: CollectGitDiffResult = {
      manifest,
      patchPath,
      hasBinaryFiles,
      hasOutsideRepoPaths,
      hasLockfileChanges,
      hasSensitiveFiles,
      unrelatedFiles,
      diffSummary,
    };
    runtime.trace("collect_git_diff", true, diffSummary, {
      durationMs: Date.now() - started,
    });
    return result;
  } catch (e) {
    runtime.trace("collect_git_diff", false, e instanceof Error ? e.message : String(e), {
      errorCode: e instanceof IssueToolError ? e.code : "GIT_ERROR",
      durationMs: Date.now() - started,
    });
    throw e;
  }
}

function git(cwd: string, args: string[]): string {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) {
    throw new IssueToolError("GIT_ERROR", `git ${args.join(" ")} failed: ${String(e)}`);
  }
}

function isLockfile(file: string): boolean {
  return /(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|poetry\.lock)$/.test(file);
}

function plannedHas(planned: Set<string>, file: string): boolean {
  for (const p of planned) {
    if (file === p || file.endsWith("/" + p) || p.endsWith("/" + file)) return true;
  }
  return false;
}
