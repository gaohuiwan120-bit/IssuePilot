import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolve, join } from "node:path";
import { homedir } from "node:os";
import { DEFAULT_DOCKER_POLICY, loadDockerPolicy } from "../dist/docker/policy.js";
import {
  validateExecutionRequest,
  buildDockerRunArgs,
  buildExecutionApprovalMaterial,
} from "../dist/docker/validate.js";
import { DockerExecutionError } from "../dist/docker/types.js";
import {
  assertPolicySafetyInvariants,
  policyForbidsDockerSocket,
  policyForbidsPrivileged,
  policyForbidsHostNetwork,
  isHomeMountForbidden,
  DockerExecutor,
} from "../dist/docker/executor.js";
import { ApprovalService } from "../dist/security/approval.js";
import { PROJECT_ROOT } from "./helpers/project-root.js";

const REPO = PROJECT_ROOT;
/** Sibling path pattern used as a forbidden root (directory need not exist). */
const UPSTREAM = resolve(REPO, "..", "pi-upstream");

function baseReq(over = {}) {
  return {
    taskId: "task-docker-1",
    executionType: "test",
    image: "issuepilot-node:local",
    command: ["node", "-e", "console.log(1)"],
    repositoryPath: REPO,
    workingDirectory: REPO,
    environment: { NODE_ENV: "test" },
    requiresWriteAccess: false,
    requiresNetwork: false,
    ...over,
  };
}

describe("Docker policy defaults", () => {
  it("1. default network is none", () => {
    assert.equal(DEFAULT_DOCKER_POLICY.networkMode, "none");
    assert.equal(loadDockerPolicy().networkMode, "none");
  });

  it("2. default repository mount is read-only", () => {
    assert.equal(DEFAULT_DOCKER_POLICY.repositoryMountMode, "read-only");
  });

  it("3. requires non-root user", () => {
    const v = assertPolicySafetyInvariants(DEFAULT_DOCKER_POLICY);
    assert.equal(v.length, 0);
    assert.notEqual(DEFAULT_DOCKER_POLICY.runAsUser, "0");
    assert.notEqual(DEFAULT_DOCKER_POLICY.runAsUser, "root");
  });

  it("4. docker socket is forbidden by construction", () => {
    assert.equal(policyForbidsDockerSocket(DEFAULT_DOCKER_POLICY), true);
    assert.throws(
      () =>
        validateExecutionRequest({
          request: baseReq({ command: ["cat", "/var/run/docker.sock"] }),
          policy: DEFAULT_DOCKER_POLICY,
        }),
      (e) => e instanceof DockerExecutionError,
    );
  });

  it("5. home directory mount is forbidden", () => {
    const home = homedir();
    assert.equal(isHomeMountForbidden(home, home), true);
    assert.throws(
      () =>
        validateExecutionRequest({
          request: baseReq({ repositoryPath: home, workingDirectory: home }),
          policy: DEFAULT_DOCKER_POLICY,
          hostHomePath: home,
        }),
      (e) => e instanceof DockerExecutionError && e.code === "INVALID_REPOSITORY_PATH",
    );
  });

  it("6. privileged is forbidden", () => {
    assert.equal(policyForbidsPrivileged(), true);
    assert.throws(
      () =>
        validateExecutionRequest({
          request: { ...baseReq(), privileged: true },
          policy: DEFAULT_DOCKER_POLICY,
        }),
      (e) => e instanceof DockerExecutionError && e.code === "POLICY_VIOLATION",
    );
  });

  it("7. host network is forbidden", () => {
    assert.equal(policyForbidsHostNetwork("none"), true);
    assert.equal(policyForbidsHostNetwork("host"), false);
    assert.throws(
      () =>
        validateExecutionRequest({
          request: { ...baseReq(), hostNetwork: true },
          policy: DEFAULT_DOCKER_POLICY,
        }),
      (e) => e instanceof DockerExecutionError,
    );
  });

  it("8. rejects non-allowlisted images", () => {
    assert.throws(
      () =>
        validateExecutionRequest({
          request: baseReq({ image: "random/evil:latest" }),
          policy: DEFAULT_DOCKER_POLICY,
        }),
      (e) => e instanceof DockerExecutionError && e.code === "IMAGE_NOT_ALLOWED",
    );
  });

  it("9. rejects non-allowlisted environment variables", () => {
    assert.throws(
      () =>
        validateExecutionRequest({
          request: baseReq({ environment: { AWS_SECRET_ACCESS_KEY: "x" } }),
          policy: DEFAULT_DOCKER_POLICY,
        }),
      (e) => e instanceof DockerExecutionError && e.code === "INVALID_ENVIRONMENT",
    );
  });

  it("10. rejects paths outside repository (working dir)", () => {
    assert.throws(
      () =>
        validateExecutionRequest({
          request: baseReq({
            workingDirectory: resolve(REPO, "..", "pi-upstream"),
          }),
          policy: DEFAULT_DOCKER_POLICY,
        }),
      (e) =>
        e instanceof DockerExecutionError &&
        (e.code === "INVALID_WORKING_DIRECTORY" || e.code === "INVALID_REPOSITORY_PATH"),
    );
  });

  it("11. rejects pi-upstream as repository", () => {
    assert.throws(
      () =>
        validateExecutionRequest({
          request: baseReq({
            repositoryPath: UPSTREAM,
            workingDirectory: UPSTREAM,
          }),
          policy: DEFAULT_DOCKER_POLICY,
          forbiddenRoots: [UPSTREAM],
        }),
      (e) => e instanceof DockerExecutionError && e.code === "INVALID_REPOSITORY_PATH",
    );
  });

  it("12. write access elevates risk and requires approval", () => {
    assert.throws(
      () =>
        validateExecutionRequest({
          request: baseReq({ requiresWriteAccess: true }),
          policy: DEFAULT_DOCKER_POLICY,
        }),
      (e) => e instanceof DockerExecutionError && e.code === "WRITE_ACCESS_NOT_ALLOWED",
    );
  });

  it("13. network request requires approval", () => {
    assert.throws(
      () =>
        validateExecutionRequest({
          request: baseReq({ requiresNetwork: true }),
          policy: DEFAULT_DOCKER_POLICY,
        }),
      (e) => e instanceof DockerExecutionError && e.code === "NETWORK_NOT_ALLOWED",
    );
  });

  it("14. invalid approval is rejected", async () => {
    const svc = new ApprovalService({ resolver: async () => "approved" });
    const req = baseReq({ requiresNetwork: true, approvalId: "not-a-real-id" });
    assert.throws(
      () =>
        validateExecutionRequest({
          request: req,
          policy: DEFAULT_DOCKER_POLICY,
          approvalService: svc,
        }),
      (e) => e instanceof DockerExecutionError && e.code === "APPROVAL_INVALID",
    );
  });

  it("15. expired approval is rejected", async () => {
    let now = Date.parse("2026-01-01T00:00:00.000Z");
    const svc = new ApprovalService({
      resolver: async () => "approved",
      now: () => new Date(now),
    });
    const req = baseReq({ requiresNetwork: true });
    const material = buildExecutionApprovalMaterial(req, DEFAULT_DOCKER_POLICY);
    const decided = await svc.requestApproval({
      taskId: req.taskId,
      toolName: "run_in_docker",
      assessment: material.assessment,
      input: material.hashInput,
      ttlMs: 1000,
    });
    now += 60_000;
    assert.throws(
      () =>
        validateExecutionRequest({
          request: { ...req, approvalId: decided.approvalId },
          policy: DEFAULT_DOCKER_POLICY,
          approvalService: svc,
        }),
      (e) => e instanceof DockerExecutionError && e.code === "APPROVAL_INVALID",
    );
  });

  it("16. command array is passed as separate argv (not shell-joined)", () => {
    const validated = validateExecutionRequest({
      request: baseReq({
        command: ["node", "-e", "console.log('a b')"],
      }),
      policy: DEFAULT_DOCKER_POLICY,
    });
    const args = buildDockerRunArgs({ containerName: "ip-test", validated });
    const imgIdx = args.indexOf(validated.request.image);
    assert.ok(imgIdx >= 0);
    assert.deepEqual(args.slice(imgIdx + 1), ["node", "-e", "console.log('a b')"]);
    assert.ok(args.includes("--network"));
    assert.equal(args[args.indexOf("--network") + 1], "none");
    assert.ok(args.includes("--read-only"));
    assert.ok(args.includes("--user"));
    assert.ok(!args.includes("--privileged"));
    assert.ok(!args.some((a) => String(a).includes("docker.sock")));
    const vol = args[args.indexOf("-v") + 1];
    assert.match(vol, /:ro$/);
  });

  it("17. validates taskId and working directory", () => {
    assert.throws(
      () =>
        validateExecutionRequest({
          request: baseReq({ taskId: "../evil" }),
          policy: DEFAULT_DOCKER_POLICY,
        }),
      (e) => e instanceof DockerExecutionError && e.code === "INVALID_TASK_ID",
    );
    assert.throws(
      () =>
        validateExecutionRequest({
          request: baseReq({ workingDirectory: join(REPO, "..", "other") }),
          policy: DEFAULT_DOCKER_POLICY,
        }),
      (e) => e instanceof DockerExecutionError,
    );
  });

  it("blocks destructive commands", () => {
    assert.throws(
      () =>
        validateExecutionRequest({
          request: baseReq({ command: ["git", "reset", "--hard"] }),
          policy: DEFAULT_DOCKER_POLICY,
        }),
      (e) => e instanceof DockerExecutionError && e.code === "COMMAND_BLOCKED",
    );
  });

  it("accepts valid network request with matching approval", async () => {
    const svc = new ApprovalService({ resolver: async () => "approved" });
    const req = baseReq({ requiresNetwork: true });
    const material = buildExecutionApprovalMaterial(req, DEFAULT_DOCKER_POLICY);
    const decided = await svc.requestApproval({
      taskId: req.taskId,
      toolName: "run_in_docker",
      assessment: material.assessment,
      input: material.hashInput,
    });
    const validated = validateExecutionRequest({
      request: { ...req, approvalId: decided.approvalId },
      policy: DEFAULT_DOCKER_POLICY,
      approvalService: svc,
    });
    assert.equal(validated.networkMode, "restricted");
    assert.equal(validated.assessment.level, "high");
  });

  it("mock executor records cleanup and summaries without real docker", async () => {
    const cli = {
      async run() {
        return {
          exitCode: 0,
          stdout: "ok",
          stderr: "",
          timedOut: false,
        };
      },
      async killContainer() {
        return true;
      },
      async removeContainer() {
        return true;
      },
    };
    const executor = new DockerExecutor({
      cli,
      skipAvailabilityCheck: true,
      skipImageCheck: true,
      outputsRoot: join(REPO, "outputs"),
      policy: DEFAULT_DOCKER_POLICY,
    });
    const result = await executor.execute(baseReq({ taskId: "mock-exec-1" }));
    assert.equal(result.success, true);
    assert.equal(result.cleanupSucceeded, true);
    assert.equal(result.appliedPolicy?.networkMode, "none");
    assert.equal(result.appliedPolicy?.runAsUser, "1000:1000");
  });
});
