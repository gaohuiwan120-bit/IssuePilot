import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { readFileSync, cpSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { detectDockerAvailability, imageExistsLocally } from "../dist/docker/availability.js";
import { reproduceIssue } from "../dist/tools/reproduce-issue.js";
import { runValidation } from "../dist/tools/run-validation.js";
import { PROJECT_ROOT } from "./helpers/project-root.js";

const ROOT = PROJECT_ROOT;
const FIX = join(ROOT, "fixtures/issues");

let dockerOk = false;
let nodeImage = false;
let pythonImage = false;

before(async () => {
  const avail = await detectDockerAvailability();
  dockerOk = avail.available;
  if (dockerOk) {
    nodeImage = await imageExistsLocally("issuepilot-node:local");
    pythonImage = await imageExistsLocally("issuepilot-python:local");
  }
  console.log(
    `[issue-tools-docker] available=${dockerOk} node=${nodeImage} python=${pythonImage}`,
  );
});

function skip(t, reason) {
  t.skip(reason);
}

describe("Issue tools real Docker", () => {
  it("node-validation-bug reproduces failure", async (t) => {
    if (!dockerOk || !nodeImage) return skip(t, "docker/node image unavailable");
    const repo = join(FIX, "node-validation-bug");
    const cfg = JSON.parse(readFileSync(join(repo, "reproduce.json"), "utf8"));
    const r = await reproduceIssue({
      taskId: "dock-nv-repro",
      repositoryPath: repo,
      commands: cfg.commands,
      expectedFailure: cfg.expectedFailure,
      image: "issuepilot-node:local",
    });
    assert.equal(r.status, "reproduced");
    assert.equal(r.reproduced, true);
  });

  it("node-config-bug reproduces failure", async (t) => {
    if (!dockerOk || !nodeImage) return skip(t, "docker/node image unavailable");
    const repo = join(FIX, "node-config-bug");
    const cfg = JSON.parse(readFileSync(join(repo, "reproduce.json"), "utf8"));
    const r = await reproduceIssue({
      taskId: "dock-nc-repro",
      repositoryPath: repo,
      commands: cfg.commands,
      expectedFailure: cfg.expectedFailure,
      image: "issuepilot-node:local",
    });
    assert.equal(r.status, "reproduced");
  });

  it("python-path-bug reproduces failure", async (t) => {
    if (!dockerOk || !pythonImage) return skip(t, "docker/python image unavailable");
    const repo = join(FIX, "python-path-bug");
    const cfg = JSON.parse(readFileSync(join(repo, "reproduce.json"), "utf8"));
    const r = await reproduceIssue({
      taskId: "dock-pp-repro",
      repositoryPath: repo,
      commands: cfg.commands,
      expectedFailure: cfg.expectedFailure,
      image: "issuepilot-python:local",
    });
    assert.equal(r.status, "reproduced");
  });

  it("python-exception-bug reproduces failure", async (t) => {
    if (!dockerOk || !pythonImage) return skip(t, "docker/python image unavailable");
    const repo = join(FIX, "python-exception-bug");
    const cfg = JSON.parse(readFileSync(join(repo, "reproduce.json"), "utf8"));
    const r = await reproduceIssue({
      taskId: "dock-pe-repro",
      repositoryPath: repo,
      commands: cfg.commands,
      expectedFailure: cfg.expectedFailure,
      image: "issuepilot-python:local",
    });
    assert.equal(r.status, "reproduced");
  });

  it("safe-clean-project not_reproduced when expecting failure", async (t) => {
    if (!dockerOk || !nodeImage) return skip(t, "docker/node image unavailable");
    const repo = join(FIX, "safe-clean-project");
    const r = await reproduceIssue({
      taskId: "dock-clean-repro",
      repositoryPath: repo,
      commands: [["node", "test/hello.test.js"]],
      expectedFailure: { exitCode: 1, stderrPattern: "FAIL" },
      image: "issuepilot-node:local",
    });
    assert.equal(r.status, "not_reproduced");
  });

  it("golden fixed node-validation passes validation", async (t) => {
    if (!dockerOk || !nodeImage) return skip(t, "docker/node image unavailable");
    const tmp = join(FIX, ".work/node-validation-fixed");
    rmSync(tmp, { recursive: true, force: true });
    mkdirSync(join(FIX, ".work"), { recursive: true });
    cpSync(join(FIX, "node-validation-bug"), tmp, {
      recursive: true,
      filter: (src) => !/[\\/]\.git([\\/]|$)/.test(src) && !/[\\/]outputs([\\/]|$)/.test(src),
    });
    cpSync(
      join(FIX, "node-validation-bug/golden/fixed/src/validate.js"),
      join(tmp, "src/validate.js"),
    );
    const r = await runValidation({
      taskId: "dock-nv-fixed",
      repositoryPath: tmp,
      testCommands: [["node", "test/validate.test.js"]],
      acceptanceCriteria: ["Empty email rejected"],
      acceptanceEvidenceText: "PASS validateUser Empty email rejected",
      image: "issuepilot-node:local",
    });
    assert.equal(r.testsPassed, true);
    assert.equal(r.overallPassed, true);
  });

  it("golden fixed python-path passes validation", async (t) => {
    if (!dockerOk || !pythonImage) return skip(t, "docker/python image unavailable");
    const tmp = join(FIX, ".work/python-path-fixed");
    rmSync(tmp, { recursive: true, force: true });
    mkdirSync(join(FIX, ".work"), { recursive: true });
    cpSync(join(FIX, "python-path-bug"), tmp, {
      recursive: true,
      filter: (src) => !/[\\/]\.git([\\/]|$)/.test(src) && !/[\\/]outputs([\\/]|$)/.test(src),
    });
    cpSync(
      join(FIX, "python-path-bug/golden/fixed/app/paths.py"),
      join(tmp, "app/paths.py"),
    );
    const r = await runValidation({
      taskId: "dock-pp-fixed",
      repositoryPath: tmp,
      testCommands: [["python", "tests/run_paths.py"]],
      acceptanceCriteria: ["joined path"],
      acceptanceEvidenceText: "PASS resolve_data_path joined path",
      image: "issuepilot-python:local",
    });
    assert.equal(r.testsPassed, true);
    assert.equal(r.overallPassed, true);
  });

  it("timeout scenario", async (t) => {
    if (!dockerOk || !nodeImage) return skip(t, "docker/node image unavailable");
    const { DockerExecutor } = await import("../dist/docker/executor.js");
    const { DEFAULT_DOCKER_POLICY } = await import("../dist/docker/policy.js");
    const executor = new DockerExecutor({
      policy: { ...DEFAULT_DOCKER_POLICY, timeoutMs: 2000 },
      outputsRoot: join(FIX, "safe-clean-project/outputs"),
    });
    const r = await reproduceIssue({
      taskId: "dock-timeout-1",
      repositoryPath: join(FIX, "safe-clean-project"),
      commands: [["node", "-e", "while(true){}"]],
      expectedFailure: { exitCode: 1 },
      image: "issuepilot-node:local",
      executor,
    });
    assert.equal(r.status, "timeout");
  });

  it("read-only mount: write attempt fails or is non-writable", async (t) => {
    if (!dockerOk || !nodeImage) return skip(t, "docker/node image unavailable");
    const repo = join(FIX, "safe-clean-project");
    const r = await reproduceIssue({
      taskId: "dock-ro-1",
      repositoryPath: repo,
      commands: [
        [
          "node",
          "--input-type=commonjs",
          "-e",
          "try{require('fs').writeFileSync('should-not-write.txt','x'); console.log('WROTE'); process.exit(0)}catch(e){console.error('READONLY'); process.exit(2)}",
        ],
      ],
      expectedFailure: { exitCode: 2, stderrPattern: "READONLY" },
      image: "issuepilot-node:local",
    });
    assert.equal(r.reproduced, true);
    assert.ok(!existsSync(join(repo, "should-not-write.txt")));
  });
});
