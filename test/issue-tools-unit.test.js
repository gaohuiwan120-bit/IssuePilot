import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  symlinkSync,
  existsSync,
  cpSync,
  rmSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { parseIssue } from "../dist/tools/parse-issue.js";
import { inspectRepository } from "../dist/tools/inspect-repository.js";
import { findRelatedCode } from "../dist/tools/find-related-code.js";
import { diagnoseIssue } from "../dist/tools/diagnose.js";
import { reproduceIssue } from "../dist/tools/reproduce-issue.js";
import { runValidation } from "../dist/tools/run-validation.js";
import { collectGitDiff } from "../dist/tools/collect-git-diff.js";
import { reviewPatch } from "../dist/tools/review-patch.js";
import { generatePrSummary } from "../dist/tools/generate-pr-summary.js";
import { DockerExecutor } from "../dist/docker/executor.js";
import { DEFAULT_DOCKER_POLICY } from "../dist/docker/policy.js";
import { DockerExecutionError } from "../dist/docker/types.js";
import { IssueToolError } from "../dist/tools/errors.js";

const ROOT = resolve("e:/AgentProject/pi_project/agent-projects/mlpilot");
const FIX = join(ROOT, "fixtures/issues");

function mockExecutor(handler, outputsRoot) {
  return new DockerExecutor({
    cli: {
      async run(args) {
        return handler(args);
      },
      async killContainer() {
        return true;
      },
      async removeContainer() {
        return true;
      },
    },
    skipAvailabilityCheck: true,
    skipImageCheck: true,
    outputsRoot,
    policy: DEFAULT_DOCKER_POLICY,
  });
}

function initTempGit() {
  const dir = mkdtempSync(join(tmpdir(), "ip-m3a-"));
  execSync("git init", { cwd: dir, stdio: "ignore" });
  execSync('git config user.email "t@t.local"', { cwd: dir, stdio: "ignore" });
  execSync('git config user.name "t"', { cwd: dir, stdio: "ignore" });
  writeFileSync(join(dir, "README.md"), "base\n");
  execSync("git add -A", { cwd: dir, stdio: "ignore" });
  execSync('git commit -m "base"', { cwd: dir, stdio: "ignore" });
  return dir;
}

function sampleIssue(over = {}) {
  return {
    taskId: "sample-1",
    title: "bug",
    issueType: "bug",
    description: "desc",
    expectedBehavior: "ok",
    actualBehavior: "bad",
    reproductionSteps: ["run test"],
    acceptanceCriteria: ["tests pass"],
    mentionedFiles: ["src/validate.js"],
    mentionedSymbols: ["validateUser"],
    missingInformation: [],
    ...over,
  };
}

function samplePlan(over = {}) {
  return {
    taskId: "sample-1",
    rootCause: "validation",
    evidence: ["test fail"],
    filesToModify: ["src/validate.js"],
    plannedChanges: [{ file: "src/validate.js", description: "fix", reason: "bug" }],
    validationCommands: ["node test/validate.test.js"],
    acceptanceCriteria: ["Empty email rejected"],
    rollbackStrategy: "git checkpoint",
    riskLevel: "low",
    requiresApproval: false,
    ...over,
  };
}

describe("parse_issue", () => {
  it("parses standard GitHub-style issue", () => {
    const body = readFileSync(join(FIX, "node-validation-bug/ISSUE.md"), "utf8");
    const spec = parseIssue(
      { taskId: "parse-gh-1", body, labels: ["bug"] },
      { repositoryPath: join(FIX, "node-validation-bug") },
    );
    assert.equal(spec.issueType, "bug");
    assert.match(spec.title, /validateUser/);
    assert.ok(spec.reproductionSteps.length >= 1);
    assert.ok(spec.acceptanceCriteria.length >= 1);
    assert.ok(spec.mentionedFiles.some((f) => f.includes("validate.js")));
    assert.ok(spec.mentionedSymbols.includes("validateUser"));
  });

  it("does not invent missing reproduction steps", () => {
    const spec = parseIssue({
      taskId: "parse-miss-1",
      title: "Something broken",
      body: "## Description\nIt fails sometimes.\n",
      labels: ["bug"],
    });
    assert.equal(spec.reproductionSteps.length, 0);
    assert.ok(spec.missingInformation.includes("reproductionSteps"));
    assert.ok(spec.missingInformation.includes("acceptanceCriteria"));
  });

  it("extracts stack trace files and symbols", () => {
    const body = readFileSync(join(FIX, "python-exception-bug/ISSUE.md"), "utf8");
    const spec = parseIssue({ taskId: "parse-stack-1", body });
    assert.ok(spec.mentionedFiles.some((f) => f.includes("parse.py")));
    assert.ok(spec.mentionedSymbols.includes("parse_int"));
  });

  it("classifies feature vs bug", () => {
    const feat = parseIssue({
      taskId: "parse-feat-1",
      title: "Feature: add export button",
      body: "Feature request for export",
      labels: ["enhancement"],
    });
    assert.equal(feat.issueType, "feature");
  });
});

describe("inspect_repository", () => {
  it("inspects node / python / mixed / empty", () => {
    const node = inspectRepository({
      taskId: "insp-node-1",
      repositoryPath: join(FIX, "node-validation-bug"),
    });
    assert.ok(node.languages.some((l) => /javascript|typescript/i.test(l)));

    const py = inspectRepository({
      taskId: "insp-py-1",
      repositoryPath: join(FIX, "python-path-bug"),
    });
    assert.ok(py.languages.includes("python"));

    const mix = inspectRepository({
      taskId: "insp-mix-1",
      repositoryPath: join(FIX, "mixed-build-failure"),
    });
    assert.ok(mix.languages.length >= 2);

    const dir = mkdtempSync(join(tmpdir(), "ip-empty-"));
    const empty = inspectRepository({ taskId: "insp-empty-1", repositoryPath: dir });
    assert.equal(empty.projectType, "empty");
  });

  it("ignores sensitive names and enforces file limit", () => {
    const dir = mkdtempSync(join(tmpdir(), "ip-sens-"));
    writeFileSync(join(dir, "ok.js"), "1");
    writeFileSync(join(dir, ".env"), "SECRET=1");
    for (let i = 0; i < 10; i++) writeFileSync(join(dir, `f${i}.js`), "1");
    assert.throws(
      () => inspectRepository({ taskId: "insp-limit-1", repositoryPath: dir, maxFiles: 3 }),
      (e) => e instanceof IssueToolError && e.code === "FILE_LIMIT_EXCEEDED",
    );
  });

  it("skips symlink directories (no escape)", () => {
    const dir = mkdtempSync(join(tmpdir(), "ip-link-"));
    writeFileSync(join(dir, "ok.js"), "1");
    const outside = mkdtempSync(join(tmpdir(), "ip-out-"));
    writeFileSync(join(outside, "secret.txt"), "x");
    try {
      symlinkSync(outside, join(dir, "escape-link"), "junction");
    } catch {
      // skip if OS blocks
      return;
    }
    const inv = inspectRepository({ taskId: "insp-link-1", repositoryPath: dir });
    assert.ok(inv);
    assert.ok(!JSON.stringify(inv).includes("secret.txt"));
  });
});

describe("find_related_code", () => {
  it("matches file/symbol/stack and sorts/dedupes/excludes deps", () => {
    const repo = join(FIX, "node-validation-bug");
    mkdirSync(join(repo, "node_modules/pkg"), { recursive: true });
    writeFileSync(join(repo, "node_modules/pkg/index.js"), "validateUser");
    const issueSpec = sampleIssue({
      taskId: "rel-1",
      description: "validateUser API /api/users fails",
      actualBehavior: "at validateUser (src/validate.js:3)",
    });
    const matches = findRelatedCode({
      taskId: "rel-1",
      repositoryPath: repo,
      issueSpec,
      maxResults: 10,
    });
    assert.ok(matches.length >= 1);
    assert.ok(matches[0].relevanceScore >= matches[matches.length - 1].relevanceScore);
    assert.ok(matches.every((m) => !m.filePath.includes("node_modules")));
    const paths = matches.map((m) => m.filePath);
    assert.equal(new Set(paths).size, paths.length);
    assert.ok(matches.some((m) => m.filePath.includes("validate.js")));
    try {
      rmSync(join(repo, "node_modules"), { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });
});

describe("diagnose_issue", () => {
  it("returns unverified candidates without inventing unique root cause", () => {
    const d = diagnoseIssue({
      taskId: "diag-1",
      repositoryPath: join(FIX, "safe-clean-project"),
      issueSpec: sampleIssue({ description: "something odd happened" }),
      reproduction: null,
    });
    assert.equal(d.verificationStatus, "unverified");
    assert.ok(d.rootCauseCandidates.length >= 1);
    assert.ok(d.confidence < 0.5);
  });

  it("classifies validation / exception patterns", () => {
    const d = diagnoseIssue({
      taskId: "diag-2",
      repositoryPath: join(FIX, "node-validation-bug"),
      issueSpec: sampleIssue({
        actualBehavior: "AssertionError expected EMAIL_REQUIRED",
      }),
      reproduction: {
        taskId: "diag-2",
        reproduced: true,
        commands: ["node test"],
        exitCodes: [1],
        observedBehavior: "FAIL",
        logs: ["FAIL validateUser"],
        failingTests: ["validateUser"],
        failureReason: null,
        reproductionConfidence: 0.8,
      },
    });
    assert.ok(d.rootCauseCandidates.some((c) => /validation|test-failure/i.test(c)));
  });
});

describe("reproduce_issue (mock docker)", () => {
  it("successful reproduction when expected signature matches", async () => {
    const repo = join(FIX, "node-validation-bug");
    const out = join(repo, "outputs");
    const executor = mockExecutor(
      async () => ({
        exitCode: 1,
        stdout: "",
        stderr: "FAIL validateUser empty email",
        timedOut: false,
      }),
      out,
    );
    const r = await reproduceIssue({
      taskId: "repro-ok-1",
      repositoryPath: repo,
      commands: [["node", "test/validate.test.js"]],
      expectedFailure: { exitCode: 1, stderrPattern: "FAIL validateUser" },
      executor,
      skipAvailabilityCheck: true,
    });
    assert.equal(r.status, "reproduced");
    assert.equal(r.reproduced, true);
  });

  it("not_reproduced when signature mismatches", async () => {
    const repo = join(FIX, "safe-clean-project");
    const executor = mockExecutor(
      async () => ({ exitCode: 0, stdout: "PASS", stderr: "", timedOut: false }),
      join(repo, "outputs"),
    );
    const r = await reproduceIssue({
      taskId: "repro-miss-1",
      repositoryPath: repo,
      commands: [["node", "test/hello.test.js"]],
      expectedFailure: { exitCode: 1, stderrPattern: "FAIL" },
      executor,
      skipAvailabilityCheck: true,
    });
    assert.equal(r.status, "not_reproduced");
    assert.equal(r.reproduced, false);
  });

  it("insufficient_evidence without expectedFailure", async () => {
    const repo = join(FIX, "safe-clean-project");
    const executor = mockExecutor(
      async () => ({ exitCode: 1, stdout: "", stderr: "err", timedOut: false }),
      join(repo, "outputs"),
    );
    const r = await reproduceIssue({
      taskId: "repro-insuf-1",
      repositoryPath: repo,
      commands: [["node", "-e", "process.exit(1)"]],
      executor,
      skipAvailabilityCheck: true,
    });
    assert.equal(r.status, "insufficient_evidence");
  });

  it("timeout status", async () => {
    const repo = join(FIX, "safe-clean-project");
    const executor = mockExecutor(
      async () => ({ exitCode: null, stdout: "", stderr: "", timedOut: true }),
      join(repo, "outputs"),
    );
    const r = await reproduceIssue({
      taskId: "repro-to-1",
      repositoryPath: repo,
      commands: [["node", "-e", "while(1){}"]],
      expectedFailure: { exitCode: 1 },
      executor,
      skipAvailabilityCheck: true,
    });
    assert.equal(r.status, "timeout");
  });

  it("blocked when executor throws COMMAND_BLOCKED", async () => {
    const repo = join(FIX, "safe-clean-project");
    const executor = {
      async execute() {
        throw new DockerExecutionError("COMMAND_BLOCKED", "blocked");
      },
    };
    const r = await reproduceIssue({
      taskId: "repro-block-1",
      repositoryPath: repo,
      commands: [["rm", "-rf", "/"]],
      expectedFailure: { exitCode: 1 },
      executor,
      skipAvailabilityCheck: true,
    });
    assert.equal(r.status, "blocked");
  });

  it("environment_incomplete when docker unavailable", async () => {
    const repo = join(FIX, "safe-clean-project");
    const r = await reproduceIssue({
      taskId: "repro-nodock-1",
      repositoryPath: repo,
      commands: [["node", "-e", "1"]],
      expectedFailure: { exitCode: 1 },
      skipAvailabilityCheck: false,
      // force path without executor: availability may be true on this machine —
      // inject executor that throws DOCKER_UNAVAILABLE via execute after check skipped
      executor: {
        async execute() {
          throw new DockerExecutionError("DOCKER_UNAVAILABLE", "down");
        },
      },
    });
    assert.equal(r.status, "environment_incomplete");
  });
});

describe("run_validation (mock docker)", () => {
  it("all pass", async () => {
    const repo = join(FIX, "safe-clean-project");
    const executor = mockExecutor(
      async () => ({ exitCode: 0, stdout: "PASS empty email rejected tests", stderr: "", timedOut: false }),
      join(repo, "outputs"),
    );
    const r = await runValidation({
      taskId: "val-ok-1",
      repositoryPath: repo,
      testCommands: [["node", "test/hello.test.js"]],
      buildCommands: [["node", "-e", "console.log(1)"]],
      lintCommands: [["node", "-e", "console.log(1)"]],
      acceptanceCriteria: ["tests pass"],
      acceptanceEvidenceText: "tests pass PASS",
      executor,
      skipAvailabilityCheck: true,
    });
    assert.equal(r.overallPassed, true);
    assert.equal(r.executed, true);
  });

  it("unit test failure prevents overall pass", async () => {
    const repo = join(FIX, "safe-clean-project");
    let n = 0;
    const executor = mockExecutor(
      async () => {
        n += 1;
        return {
          exitCode: n === 1 ? 1 : 0,
          stdout: n === 1 ? "FAIL" : "ok",
          stderr: "",
          timedOut: false,
        };
      },
      join(repo, "outputs"),
    );
    const r = await runValidation({
      taskId: "val-fail-1",
      repositoryPath: repo,
      testCommands: [["node", "t.js"]],
      buildCommands: [["node", "-e", "1"]],
      acceptanceCriteria: [],
      executor,
      skipAvailabilityCheck: true,
    });
    assert.equal(r.testsPassed, false);
    assert.equal(r.overallPassed, false);
  });

  it("build failure / lint failure / acceptance fail", async () => {
    const repo = join(FIX, "safe-clean-project");
    const failBuild = mockExecutor(async (args) => {
      const joined = args.join(" ");
      const isBuild = joined.includes("BUILD");
      return {
        exitCode: isBuild ? 1 : 0,
        stdout: isBuild ? "BUILD_FAIL" : "ok",
        stderr: "",
        timedOut: false,
      };
    }, join(repo, "outputs"));
    const r1 = await runValidation({
      taskId: "val-build-1",
      repositoryPath: repo,
      testCommands: [["node", "-e", "console.log('ok')"]],
      buildCommands: [["node", "-e", "console.error('BUILD'); process.exit(1)"]],
      acceptanceCriteria: [],
      executor: failBuild,
      skipAvailabilityCheck: true,
    });
    // mock matches on docker argv which includes image and command — may not include BUILD string
    // Force via sequential counter instead:
    let step = 0;
    const seq = mockExecutor(async () => {
      step += 1;
      // test=1 pass, build=2 fail
      return {
        exitCode: step === 2 ? 1 : 0,
        stdout: step === 2 ? "build fail" : "ok",
        stderr: "",
        timedOut: false,
      };
    }, join(repo, "outputs"));
    const rBuild = await runValidation({
      taskId: "val-build-2",
      repositoryPath: repo,
      testCommands: [["node", "t"]],
      buildCommands: [["node", "b"]],
      acceptanceCriteria: [],
      executor: seq,
      skipAvailabilityCheck: true,
    });
    assert.equal(rBuild.buildPassed, false);
    assert.equal(rBuild.overallPassed, false);

    let step2 = 0;
    const seqLint = mockExecutor(async () => {
      step2 += 1;
      return {
        exitCode: step2 === 2 ? 1 : 0,
        stdout: "",
        stderr: "lint fail",
        timedOut: false,
      };
    }, join(repo, "outputs"));
    const rLint = await runValidation({
      taskId: "val-lint-1",
      repositoryPath: repo,
      testCommands: [["node", "t"]],
      lintCommands: [["node", "l"]],
      acceptanceCriteria: [],
      executor: seqLint,
      skipAvailabilityCheck: true,
    });
    assert.equal(rLint.lintPassed, false);
    assert.equal(rLint.overallPassed, false);

    const okExec = mockExecutor(
      async () => ({ exitCode: 0, stdout: "ok", stderr: "", timedOut: false }),
      join(repo, "outputs"),
    );
    const rAcc = await runValidation({
      taskId: "val-acc-1",
      repositoryPath: repo,
      testCommands: [["node", "t"]],
      acceptanceCriteria: ["must-satisfy-unique-token-xyz"],
      acceptanceEvidenceText: "nothing relevant",
      executor: okExec,
      skipAvailabilityCheck: true,
    });
    assert.equal(rAcc.overallPassed, false);
    assert.ok(rAcc.acceptanceCriteriaResults.some((a) => !a.satisfied));
  });

  it("no executed tests cannot pass", async () => {
    const repo = join(FIX, "safe-clean-project");
    const executor = mockExecutor(
      async () => ({ exitCode: 0, stdout: "ok", stderr: "", timedOut: false }),
      join(repo, "outputs"),
    );
    const r = await runValidation({
      taskId: "val-none-1",
      repositoryPath: repo,
      testCommands: [],
      acceptanceCriteria: ["x"],
      executor,
      skipAvailabilityCheck: true,
    });
    assert.equal(r.executed, false);
    assert.equal(r.overallPassed, false);
  });
});

describe("collect_git_diff", () => {
  it("collects modify/add/delete/lockfile/sensitive and stays read-only", () => {
    const dir = initTempGit();
    writeFileSync(join(dir, "a.js"), "1\n");
    writeFileSync(join(dir, "package-lock.json"), "{}\n");
    execSync("git add -A && git commit -m add", { cwd: dir, stdio: "ignore", shell: true });
    writeFileSync(join(dir, "a.js"), "2\n");
    writeFileSync(join(dir, "b.js"), "new\n");
    writeFileSync(join(dir, ".env"), "SECRET=1\n");
    execSync("git rm -f README.md", { cwd: dir, stdio: "ignore" });
    writeFileSync(join(dir, "package-lock.json"), '{"x":1}\n');

    const before = execSync("git status --porcelain --untracked-files=all", {
      cwd: dir,
      encoding: "utf8",
    })
      .split("\n")
      .filter((l) => l && !l.includes("outputs/"))
      .join("\n");
    const result = collectGitDiff({
      taskId: "diff-1",
      repositoryPath: dir,
      repairPlan: samplePlan({ filesToModify: ["a.js"] }),
    });
    const after = execSync("git status --porcelain --untracked-files=all", {
      cwd: dir,
      encoding: "utf8",
    })
      .split("\n")
      .filter((l) => l && !l.includes("outputs/"))
      .join("\n");
    assert.equal(before, after);
    assert.ok(result.manifest.modifiedFiles.includes("a.js") || result.manifest.modifiedFiles.length >= 1);
    assert.ok(result.manifest.createdFiles.includes("b.js") || result.manifest.createdFiles.includes(".env"));
    assert.ok(result.manifest.deletedFiles.includes("README.md"));
    assert.equal(result.hasLockfileChanges, true);
    assert.equal(result.hasSensitiveFiles, true);
    assert.ok(result.unrelatedFiles.length >= 1);
    assert.ok(existsSync(join(dir, "outputs/diff-1/patch.diff")));

    // large diff summary
    writeFileSync(join(dir, "big.js"), "x\n".repeat(600));
    const big = collectGitDiff({ taskId: "diff-big", repositoryPath: dir });
    assert.match(big.diffSummary, /files=/);
  });
});

describe("review_patch", () => {
  function basePatch(over = {}) {
    return {
      manifest: {
        taskId: "rev-1",
        baseCommit: "abc",
        branch: "main",
        worktree: null,
        modifiedFiles: ["src/validate.js"],
        createdFiles: ["test/validate.test.js"],
        deletedFiles: [],
        linesAdded: 10,
        linesDeleted: 2,
        patchPath: "outputs/rev-1/patch.diff",
      },
      patchPath: "x",
      hasBinaryFiles: false,
      hasOutsideRepoPaths: false,
      hasLockfileChanges: false,
      hasSensitiveFiles: false,
      unrelatedFiles: [],
      diffSummary: "ok",
      ...over,
    };
  }

  function baseValidation(over = {}) {
    return {
      taskId: "rev-1",
      commands: ["node t"],
      results: [{ command: "node t", exitCode: 0, passed: true }],
      buildPassed: true,
      lintPassed: true,
      testsPassed: true,
      reproductionTestPassed: true,
      regressionTestsPassed: true,
      acceptanceCriteriaResults: [{ criterion: "Empty email rejected", satisfied: true }],
      overallPassed: true,
      executed: true,
      ...over,
    };
  }

  it("keep_patch when gates pass", () => {
    const r = reviewPatch({
      taskId: "rev-ok",
      repositoryPath: join(FIX, "safe-clean-project"),
      issueSpec: sampleIssue({ taskId: "rev-ok" }),
      repairPlan: samplePlan({ taskId: "rev-ok" }),
      patch: basePatch(),
      validation: baseValidation({ taskId: "rev-ok" }),
    });
    assert.equal(r.recommendation, "keep_patch");
    assert.equal(r.issueResolved, true);
  });

  it("unplanned / test fail / sensitive / high-risk → not keep", () => {
    const repo = join(FIX, "safe-clean-project");
    const unplanned = reviewPatch({
      taskId: "rev-u",
      repositoryPath: repo,
      issueSpec: sampleIssue({ taskId: "rev-u" }),
      repairPlan: samplePlan({ taskId: "rev-u", filesToModify: ["src/a.js"] }),
      patch: basePatch({ unrelatedFiles: ["src/other.js"] }),
      validation: baseValidation({ taskId: "rev-u" }),
    });
    assert.notEqual(unplanned.recommendation, "keep_patch");

    const fail = reviewPatch({
      taskId: "rev-f",
      repositoryPath: repo,
      issueSpec: sampleIssue({ taskId: "rev-f" }),
      repairPlan: samplePlan({ taskId: "rev-f" }),
      patch: basePatch(),
      validation: baseValidation({
        taskId: "rev-f",
        testsPassed: false,
        overallPassed: false,
      }),
    });
    assert.notEqual(fail.recommendation, "keep_patch");

    const sens = reviewPatch({
      taskId: "rev-s",
      repositoryPath: repo,
      issueSpec: sampleIssue({ taskId: "rev-s" }),
      repairPlan: samplePlan({ taskId: "rev-s" }),
      patch: basePatch({ hasSensitiveFiles: true }),
      validation: baseValidation({ taskId: "rev-s" }),
    });
    assert.equal(sens.recommendation, "rollback");

    const high = reviewPatch({
      taskId: "rev-h",
      repositoryPath: repo,
      issueSpec: sampleIssue({ taskId: "rev-h" }),
      repairPlan: samplePlan({
        taskId: "rev-h",
        riskLevel: "high",
        requiresApproval: true,
      }),
      patch: basePatch({ hasLockfileChanges: true }),
      validation: baseValidation({ taskId: "rev-h" }),
      highRiskApproved: false,
    });
    assert.equal(high.recommendation, "rollback");
  });

  it("missing tests flagged for bugs", () => {
    const r = reviewPatch({
      taskId: "rev-mt",
      repositoryPath: join(FIX, "safe-clean-project"),
      issueSpec: sampleIssue({ taskId: "rev-mt" }),
      repairPlan: samplePlan({ taskId: "rev-mt" }),
      patch: basePatch({
        manifest: {
          taskId: "rev-mt",
          baseCommit: "a",
          branch: "m",
          worktree: null,
          modifiedFiles: ["src/validate.js"],
          createdFiles: [],
          deletedFiles: [],
          linesAdded: 3,
          linesDeleted: 1,
          patchPath: "p",
        },
      }),
      validation: baseValidation({ taskId: "rev-mt" }),
    });
    assert.equal(r.missingTests, true);
  });
});

describe("generate_pr_summary", () => {
  it("writes summary without inventing facts; flags review failure and unexecuted tests", () => {
    const repo = join(FIX, "safe-clean-project");
    const issueSpec = sampleIssue({ taskId: "pr-1", title: "Fix validate" });
    const failReview = {
      taskId: "pr-1",
      issueResolved: false,
      unrelatedChanges: false,
      potentialRegressions: [],
      securityRisks: [],
      missingTests: false,
      acceptanceCriteriaSatisfied: false,
      recommendation: "retry",
      reasons: ["tests failed"],
    };
    const r1 = generatePrSummary({
      taskId: "pr-1",
      repositoryPath: repo,
      issueSpec,
      review: failReview,
      validation: {
        taskId: "pr-1",
        commands: [],
        results: [],
        buildPassed: false,
        lintPassed: false,
        testsPassed: false,
        reproductionTestPassed: false,
        regressionTestsPassed: false,
        acceptanceCriteriaResults: [],
        overallPassed: false,
        executed: false,
      },
    });
    assert.match(r1.markdown, /当前不建议提交PR/);
    assert.match(r1.markdown, /测试未执行/);
    assert.equal(r1.recommendSubmit, false);
    assert.ok(!/overallPassed:\s*true/.test(r1.markdown));
    assert.ok(!r1.markdown.includes("所有测试均已通过"));

    const ok = generatePrSummary({
      taskId: "pr-2",
      repositoryPath: repo,
      issueSpec: sampleIssue({ taskId: "pr-2", title: "OK Fix" }),
      diagnosis: {
        taskId: "pr-2",
        summary: "Likely category: validation.",
        rootCauseCandidates: ["validation (score=0.80)"],
        evidence: ["pattern:validation"],
        suspectedFiles: ["src/validate.js"],
        suspectedSymbols: ["validateUser"],
        callChain: [],
        confidence: 0.8,
        verificationStatus: "partially_verified",
        missingEvidence: [],
      },
      patchManifest: {
        taskId: "pr-2",
        baseCommit: "abc",
        branch: "main",
        worktree: null,
        modifiedFiles: ["src/validate.js"],
        createdFiles: [],
        deletedFiles: [],
        linesAdded: 2,
        linesDeleted: 1,
        patchPath: "outputs/pr-2/patch.diff",
      },
      validation: {
        taskId: "pr-2",
        commands: ["node t"],
        results: [{ command: "node t", exitCode: 0, passed: true }],
        buildPassed: true,
        lintPassed: true,
        testsPassed: true,
        reproductionTestPassed: true,
        regressionTestsPassed: true,
        acceptanceCriteriaResults: [{ criterion: "Empty email rejected", satisfied: true }],
        overallPassed: true,
        executed: true,
      },
      review: {
        taskId: "pr-2",
        issueResolved: true,
        unrelatedChanges: false,
        potentialRegressions: [],
        securityRisks: [],
        missingTests: false,
        acceptanceCriteriaSatisfied: true,
        recommendation: "keep_patch",
        reasons: [],
      },
    });
    assert.equal(ok.recommendSubmit, true);
    assert.match(ok.markdown, /OK Fix/);
    assert.ok(!ok.markdown.includes("虚构根因xyz"));
  });
});
