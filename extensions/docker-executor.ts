import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { DockerExecutor } from "../dist/docker/executor.js";
import { loadDockerPolicy } from "../dist/docker/policy.js";
import { ApprovalService } from "../dist/security/approval.js";
import { DockerExecutionError } from "../dist/docker/types.js";

/**
 * Controlled docker execution tool.
 * Does not accept arbitrary docker flags / mounts / privileged / host network.
 */
export default function (pi: ExtensionAPI) {
  const approvals = new ApprovalService({ defaultDenyHigh: true });

  pi.registerTool({
    name: "run_in_docker",
    label: "Docker (IssuePilot)",
    description:
      "Run an allowlisted command in an ephemeral IssuePilot sandbox container",
    parameters: Type.Object({
      executionType: Type.String(),
      image: Type.Optional(Type.String()),
      command: Type.Array(Type.String()),
      workingDirectory: Type.Optional(Type.String()),
      environment: Type.Optional(Type.Any()),
      timeoutMs: Type.Optional(Type.Number()),
      requiresWriteAccess: Type.Optional(Type.Boolean()),
      requiresNetwork: Type.Optional(Type.Boolean()),
      approvalId: Type.Optional(Type.String()),
      taskId: Type.Optional(Type.String()),
    }),
    async execute(_id, params, _s, _u, ctx) {
      const taskId =
        params.taskId ||
        (globalThis as any).__issuepilot_task_id ||
        process.env.ISSUEPILOT_TASK_ID ||
        "default";
      const policy = loadDockerPolicy();
      const executor = new DockerExecutor({
        policy,
        approvalService: approvals,
        forbiddenRoots: [
          ctx.cwd.includes("agent-projects")
            ? ctx.cwd.replace(/agent-projects.*/, "agent-projects/pi-upstream")
            : "",
        ].filter(Boolean),
        outputsRoot: `${ctx.cwd}/outputs`,
      });

      try {
        const result = await executor.execute({
          taskId,
          executionType: params.executionType as any,
          image: params.image || policy.image,
          command: params.command,
          repositoryPath: ctx.cwd,
          workingDirectory: params.workingDirectory || ctx.cwd,
          environment: params.environment || {},
          timeoutMs: params.timeoutMs,
          requiresWriteAccess: Boolean(params.requiresWriteAccess),
          requiresNetwork: Boolean(params.requiresNetwork),
          approvalId: params.approvalId,
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: result.success,
                  exitCode: result.exitCode,
                  timedOut: result.timedOut,
                  stdoutSummary: result.stdoutSummary,
                  stderrSummary: result.stderrSummary,
                  errorCode: result.errorCode,
                  errorMessage: result.errorMessage,
                  stdoutArtifactPath: result.stdoutArtifactPath,
                  stderrArtifactPath: result.stderrArtifactPath,
                },
                null,
                2,
              ),
            },
          ],
          details: result,
          isError: !result.success,
        };
      } catch (e) {
        const err =
          e instanceof DockerExecutionError
            ? e
            : new DockerExecutionError(
                "CONTAINER_START_FAILED",
                e instanceof Error ? e.message : String(e),
              );
        return {
          content: [{ type: "text", text: `${err.code}: ${err.message}` }],
          isError: true,
          details: { code: err.code, message: err.message },
        };
      }
    },
  });
}
