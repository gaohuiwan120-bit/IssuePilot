import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { resolve, join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { detectDockerAvailability, imageExistsLocally } from "../dist/docker/availability.js";
import { DockerExecutor } from "../dist/docker/executor.js";
import { DEFAULT_DOCKER_POLICY } from "../dist/docker/policy.js";

const ROOT = resolve("e:/AgentProject/pi_project/agent-projects/mlpilot");

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
    `[docker-integration] available=${dockerOk} nodeImage=${nodeImage} pythonImage=${pythonImage}`,
  );
});

function skipReason() {
  if (!dockerOk) return "Docker daemon unavailable";
  return null;
}

describe("Docker integration (environment-gated)", () => {
  it("environment probe records skip reasons without faking pass", () => {
    // Always runs: documents environment. Does not claim docker works.
    assert.equal(typeof dockerOk, "boolean");
    if (!dockerOk) {
      console.log("[docker-integration] SKIPPING real container tests: daemon down");
    } else if (!nodeImage || !pythonImage) {
      console.log(
        "[docker-integration] Images missing — build with docker/README.md instructions before full suite",
      );
    }
  });

  it("1. Node success fixture", async (t) => {
    const reason = skipReason() || (!nodeImage ? "issuepilot-node:local missing" : null);
    if (reason) {
      t.skip(reason);
      return;
    }
    const executor = new DockerExecutor({
      policy: DEFAULT_DOCKER_POLICY,
      outputsRoot: join(ROOT, "outputs"),
    });
    const result = await executor.execute({
      taskId: "it-node-pass",
      executionType: "test",
      image: "issuepilot-node:local",
      command: ["node", "fixtures/node-pass/index.js"],
      repositoryPath: ROOT,
      workingDirectory: ROOT,
      environment: { NODE_ENV: "test" },
      requiresWriteAccess: false,
    });
    assert.equal(result.exitCode, 0);
    assert.equal(result.success, true);
    assert.match(result.stdoutSummary, /node-pass ok/);
  });

  it("2. Node failure fixture", async (t) => {
    const reason = skipReason() || (!nodeImage ? "issuepilot-node:local missing" : null);
    if (reason) {
      t.skip(reason);
      return;
    }
    const executor = new DockerExecutor({
      policy: DEFAULT_DOCKER_POLICY,
      outputsRoot: join(ROOT, "outputs"),
    });
    const result = await executor.execute({
      taskId: "it-node-fail",
      executionType: "test",
      image: "issuepilot-node:local",
      command: ["node", "fixtures/node-fail/index.js"],
      repositoryPath: ROOT,
      workingDirectory: ROOT,
      environment: {},
      requiresWriteAccess: false,
    });
    assert.equal(result.exitCode, 2);
    assert.equal(result.success, false);
    assert.match(result.stderrSummary, /node-fail/);
  });

  it("3. Python success fixture", async (t) => {
    const reason = skipReason() || (!pythonImage ? "issuepilot-python:local missing" : null);
    if (reason) {
      t.skip(reason);
      return;
    }
    const executor = new DockerExecutor({
      policy: {
        ...DEFAULT_DOCKER_POLICY,
        image: "issuepilot-python:local",
      },
      outputsRoot: join(ROOT, "outputs"),
    });
    const result = await executor.execute({
      taskId: "it-py-pass",
      executionType: "test",
      image: "issuepilot-python:local",
      command: ["python", "fixtures/python-pass/main.py"],
      repositoryPath: ROOT,
      workingDirectory: ROOT,
      environment: { PYTHONUNBUFFERED: "1" },
      requiresWriteAccess: false,
    });
    assert.equal(result.exitCode, 0);
    assert.equal(result.success, true);
  });

  it("4. Python failure fixture", async (t) => {
    const reason = skipReason() || (!pythonImage ? "issuepilot-python:local missing" : null);
    if (reason) {
      t.skip(reason);
      return;
    }
    const executor = new DockerExecutor({
      policy: DEFAULT_DOCKER_POLICY,
      outputsRoot: join(ROOT, "outputs"),
    });
    const result = await executor.execute({
      taskId: "it-py-fail",
      executionType: "test",
      image: "issuepilot-python:local",
      command: ["python", "fixtures/python-fail/main.py"],
      repositoryPath: ROOT,
      workingDirectory: ROOT,
      environment: {},
      requiresWriteAccess: false,
    });
    assert.equal(result.exitCode, 3);
    assert.equal(result.success, false);
  });

  it("5-6. exit code and stdout/stderr capture", async (t) => {
    const reason = skipReason() || (!nodeImage ? "issuepilot-node:local missing" : null);
    if (reason) {
      t.skip(reason);
      return;
    }
    const executor = new DockerExecutor({
      policy: DEFAULT_DOCKER_POLICY,
      outputsRoot: join(ROOT, "outputs"),
    });
    const result = await executor.execute({
      taskId: "it-capture",
      executionType: "test",
      image: "issuepilot-node:local",
      command: ["node", "fixtures/node-fail/index.js"],
      repositoryPath: ROOT,
      workingDirectory: ROOT,
      environment: {},
      requiresWriteAccess: false,
    });
    assert.equal(result.exitCode, 2);
    assert.ok(result.stderrSummary.length > 0);
  });

  it("7. timeout terminates", async (t) => {
    const reason = skipReason() || (!pythonImage ? "issuepilot-python:local missing" : null);
    if (reason) {
      t.skip(reason);
      return;
    }
    const executor = new DockerExecutor({
      policy: { ...DEFAULT_DOCKER_POLICY, timeoutMs: 3000 },
      outputsRoot: join(ROOT, "outputs"),
    });
    const result = await executor.execute({
      taskId: "it-timeout",
      executionType: "test",
      image: "issuepilot-python:local",
      command: ["python", "fixtures/timeout-command/sleep.py"],
      repositoryPath: ROOT,
      workingDirectory: ROOT,
      environment: {},
      requiresWriteAccess: false,
      timeoutMs: 3000,
    });
    assert.equal(result.timedOut, true);
    assert.equal(result.success, false);
    assert.equal(result.errorCode, "EXECUTION_TIMEOUT");
  });

  it("8. large output writes artifacts", async (t) => {
    const reason = skipReason() || (!nodeImage ? "issuepilot-node:local missing" : null);
    if (reason) {
      t.skip(reason);
      return;
    }
    const executor = new DockerExecutor({
      policy: DEFAULT_DOCKER_POLICY,
      outputsRoot: join(ROOT, "outputs"),
    });
    const result = await executor.execute({
      taskId: "it-large",
      executionType: "test",
      image: "issuepilot-node:local",
      command: ["node", "fixtures/large-output/index.js"],
      repositoryPath: ROOT,
      workingDirectory: ROOT,
      environment: {},
      requiresWriteAccess: false,
    });
    assert.ok(result.stdoutArtifactPath);
    assert.ok(existsSync(result.stdoutArtifactPath));
    assert.ok(readFileSync(result.stdoutArtifactPath, "utf8").length > 2000);
  });

  it("9. container cleaned after run", async (t) => {
    const reason = skipReason() || (!nodeImage ? "issuepilot-node:local missing" : null);
    if (reason) {
      t.skip(reason);
      return;
    }
    const executor = new DockerExecutor({
      policy: DEFAULT_DOCKER_POLICY,
      outputsRoot: join(ROOT, "outputs"),
    });
    const result = await executor.execute({
      taskId: "it-cleanup",
      executionType: "test",
      image: "issuepilot-node:local",
      command: ["node", "fixtures/node-pass/index.js"],
      repositoryPath: ROOT,
      workingDirectory: ROOT,
      environment: {},
      requiresWriteAccess: false,
    });
    assert.equal(result.cleanupSucceeded, true);
  });

  it("10. read-only mount blocks writes", async (t) => {
    const reason = skipReason() || (!nodeImage ? "issuepilot-node:local missing" : null);
    if (reason) {
      t.skip(reason);
      return;
    }
    const executor = new DockerExecutor({
      policy: DEFAULT_DOCKER_POLICY,
      outputsRoot: join(ROOT, "outputs"),
    });
    const result = await executor.execute({
      taskId: "it-readonly",
      executionType: "test",
      image: "issuepilot-node:local",
      command: ["node", "fixtures/write-attempt/index.js"],
      repositoryPath: ROOT,
      workingDirectory: ROOT,
      environment: {},
      requiresWriteAccess: false,
    });
    assert.equal(result.exitCode, 1);
    assert.match(result.stderrSummary + result.stdoutSummary, /WRITE_BLOCKED/);
  });

  it("11. network none blocks egress", async (t) => {
    const reason = skipReason() || (!nodeImage ? "issuepilot-node:local missing" : null);
    if (reason) {
      t.skip(reason);
      return;
    }
    const executor = new DockerExecutor({
      policy: DEFAULT_DOCKER_POLICY,
      outputsRoot: join(ROOT, "outputs"),
    });
    const result = await executor.execute({
      taskId: "it-netnone",
      executionType: "test",
      image: "issuepilot-node:local",
      command: ["node", "fixtures/network-attempt/index.js"],
      repositoryPath: ROOT,
      workingDirectory: ROOT,
      environment: {},
      requiresWriteAccess: false,
      requiresNetwork: false,
    });
    assert.equal(result.success, false);
    assert.match(result.stderrSummary + result.stdoutSummary, /NETWORK_BLOCKED/);
  });

  it("12. container runs as non-root", async (t) => {
    const reason = skipReason() || (!nodeImage ? "issuepilot-node:local missing" : null);
    if (reason) {
      t.skip(reason);
      return;
    }
    const executor = new DockerExecutor({
      policy: DEFAULT_DOCKER_POLICY,
      outputsRoot: join(ROOT, "outputs"),
    });
    const result = await executor.execute({
      taskId: "it-uid",
      executionType: "test",
      image: "issuepilot-node:local",
      command: ["node", "-e", "console.log(process.getuid())"],
      repositoryPath: ROOT,
      workingDirectory: ROOT,
      environment: {},
      requiresWriteAccess: false,
    });
    assert.equal(result.success, true);
    assert.notEqual(result.stdoutSummary.trim(), "0");
  });

  it("13. resource limit flags applied in policy snapshot", async (t) => {
    const reason = skipReason() || (!nodeImage ? "issuepilot-node:local missing" : null);
    if (reason) {
      t.skip(reason);
      return;
    }
    const executor = new DockerExecutor({
      policy: DEFAULT_DOCKER_POLICY,
      outputsRoot: join(ROOT, "outputs"),
    });
    const result = await executor.execute({
      taskId: "it-limits",
      executionType: "test",
      image: "issuepilot-node:local",
      command: ["node", "fixtures/node-pass/index.js"],
      repositoryPath: ROOT,
      workingDirectory: ROOT,
      environment: {},
      requiresWriteAccess: false,
    });
    assert.equal(result.appliedPolicy?.cpuLimit, 1);
    assert.equal(result.appliedPolicy?.memoryLimitMb, 1024);
    assert.equal(result.appliedPolicy?.pidsLimit, 128);
  });

  it("14. run recorder writes execution summary", async (t) => {
    const reason = skipReason() || (!nodeImage ? "issuepilot-node:local missing" : null);
    if (reason) {
      t.skip(reason);
      return;
    }
    const executor = new DockerExecutor({
      policy: DEFAULT_DOCKER_POLICY,
      outputsRoot: join(ROOT, "outputs"),
    });
    await executor.execute({
      taskId: "it-trace",
      executionType: "test",
      image: "issuepilot-node:local",
      command: ["node", "fixtures/node-pass/index.js"],
      repositoryPath: ROOT,
      workingDirectory: ROOT,
      environment: {},
      requiresWriteAccess: false,
    });
    const trace = join(ROOT, "outputs", "it-trace", "run_trace.jsonl");
    assert.ok(existsSync(trace));
    const body = readFileSync(trace, "utf8");
    assert.match(body, /docker_/);
  });
});
