import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import {
  createGitCheckpoint,
  inspectGitRepo,
  isValidRepairBranchName,
  planRollback,
} from "../dist/git/checkpoint.js";

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function initRepo() {
  const dir = mkdtempSync(join(tmpdir(), "issuepilot-git-"));
  git(dir, ["init"]);
  git(dir, ["config", "user.name", "Test"]);
  git(dir, ["config", "user.email", "test@example.com"]);
  writeFileSync(join(dir, "README.md"), "hello\n");
  git(dir, ["add", "README.md"]);
  git(dir, ["commit", "-m", "init"]);
  return dir;
}

describe("Git Checkpoint service", () => {
  const repos = [];

  after(() => {
    for (const d of repos) {
      try {
        rmSync(d, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  });

  it("1. succeeds on clean repository (dry-run)", () => {
    const dir = initRepo();
    repos.push(dir);
    const r = createGitCheckpoint({
      taskId: "task1",
      cwd: dir,
      dryRun: true,
      strategy: "branch",
    });
    assert.equal(r.ok, true);
    assert.equal(r.status.dirty, false);
    assert.ok(r.checkpoint?.baseCommit);
    assert.equal(r.checkpoint?.strategy, "branch");
    assert.ok(isValidRepairBranchName(r.checkpoint.repairBranch));
  });

  it("2. rejects non-git directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "issuepilot-nogit-"));
    repos.push(dir);
    const r = createGitCheckpoint({ taskId: "t", cwd: dir, dryRun: true });
    assert.equal(r.ok, false);
    assert.match(r.reason ?? "", /not a git/i);
  });

  it("3. stops on dirty worktree by default", () => {
    const dir = initRepo();
    repos.push(dir);
    writeFileSync(join(dir, "dirty.txt"), "x");
    const r = createGitCheckpoint({ taskId: "t", cwd: dir, dryRun: true });
    assert.equal(r.ok, false);
    assert.match(r.reason ?? "", /dirty/i);
    assert.equal(r.status.dirty, true);
  });

  it("4. rejects detached HEAD", () => {
    const dir = initRepo();
    repos.push(dir);
    const sha = git(dir, ["rev-parse", "HEAD"]);
    git(dir, ["checkout", "--detach", sha]);
    const status = inspectGitRepo(dir);
    assert.equal(status.detachedHead, true);
    const r = createGitCheckpoint({ taskId: "t", cwd: dir, dryRun: true });
    assert.equal(r.ok, false);
    assert.match(r.reason ?? "", /detached/i);
  });

  it("5. does not overwrite preexisting user modifications (refuses dirty)", () => {
    const dir = initRepo();
    repos.push(dir);
    writeFileSync(join(dir, "README.md"), "user edit\n");
    const before = git(dir, ["status", "--porcelain"]);
    assert.ok(before.includes("README.md"));
    const r = createGitCheckpoint({
      taskId: "t",
      cwd: dir,
      dryRun: false,
      allowDirty: false,
    });
    assert.equal(r.ok, false);
    const after = git(dir, ["status", "--porcelain"]);
    assert.equal(after, before);
    // ensure file content unchanged
    assert.equal(
      readFileSync(join(dir, "README.md"), "utf8"),
      "user edit\n",
    );
  });

  it("6. validates repair branch naming", () => {
    assert.equal(isValidRepairBranchName("issuepilot/repair/task-1"), true);
    assert.equal(isValidRepairBranchName("-bad"), false);
    assert.equal(isValidRepairBranchName("has spaces"), false);
    assert.equal(isValidRepairBranchName("a..b"), false);
  });

  it("7. creates branch for real on clean repo and provides rollback plan", () => {
    const dir = initRepo();
    repos.push(dir);
    const r = createGitCheckpoint({
      taskId: "ok-branch",
      cwd: dir,
      dryRun: false,
      strategy: "branch",
      repairBranchName: "issuepilot/repair/ok-branch",
    });
    assert.equal(r.ok, true, r.reason);
    const branches = git(dir, ["branch"]);
    assert.match(branches, /issuepilot\/repair\/ok-branch/);
    const plan = planRollback(r.checkpoint);
    assert.ok(plan.some((l) => /reset --hard/i.test(l)));
  });

  it("8. refuses forbidden roots", () => {
    const dir = initRepo();
    repos.push(dir);
    const r = createGitCheckpoint({
      taskId: "t",
      cwd: dir,
      dryRun: true,
      forbiddenRoots: [dir],
    });
    assert.equal(r.ok, false);
    assert.match(r.reason ?? "", /forbidden/i);
  });
});
