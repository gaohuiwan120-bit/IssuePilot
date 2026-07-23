import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { assessToolCall } from "../dist/security/assess-risk.js";
import { ApprovalService } from "../dist/security/approval.js";
import { createRunRecorder } from "../dist/trace/run-recorder.js";
import {
  authorizeToolCall,
  callKey,
  createRuntimeState,
  recordBlocked,
  recordApprovalExpired,
  DEFAULT_WORKFLOW_LIMITS,
} from "../dist/workflow/runtime-control.js";
import { normalizeCommand } from "../dist/security/normalize.js";
import type { WorkflowStage } from "../dist/workflow/stages.js";

/**
 * Permission gate: assessment is pure (src/security); UI is optional.
 * Headless/default: medium/high denied without prior matching approval.
 */
export default function (pi: ExtensionAPI) {
  const approvals = new ApprovalService({ defaultDenyHigh: true });
  let runtime = createRuntimeState("understand");

  pi.on("tool_call", async (event, ctx) => {
    const taskId =
      (globalThis as any).__issuepilot_task_id ||
      process.env.ISSUEPILOT_TASK_ID ||
      "default";
    const stage = ((globalThis as any).__issuepilot_stage ||
      "understand") as WorkflowStage;
    const recorder = createRunRecorder(ctx.cwd, taskId);

    const assessment = assessToolCall({
      toolName: event.toolName,
      input: (event.input ?? {}) as Record<string, unknown>,
      workspaceRoot: ctx.cwd,
      forbiddenRoots: [
        ctx.cwd.includes("agent-projects")
          ? ctx.cwd.replace(/agent-projects.*/, "agent-projects/pi-upstream")
          : "",
      ].filter(Boolean),
    });

    if (assessment.blocked) {
      runtime = recordBlocked(runtime, assessment.reasons.join("; "));
      recorder.append({
        stage,
        eventType: "blocked",
        toolName: event.toolName,
        success: false,
        riskLevel: "blocked",
        summary: assessment.reasons.join("; "),
        errorCode: "BLOCKED",
      });
      return {
        block: true,
        reason: `IssuePilot blocked: ${assessment.reasons.join("; ")}`,
      };
    }

    const payloadKey = callKey(
      event.toolName,
      assessment.normalizedCommand ??
        normalizeCommand(JSON.stringify(event.input ?? {})),
    );
    const gated = authorizeToolCall(runtime, DEFAULT_WORKFLOW_LIMITS, payloadKey);
    runtime = gated.state;
    (globalThis as any).__issuepilot_runtime = runtime;
    if (!gated.decision.allow) {
      recorder.append({
        stage,
        eventType: "limit",
        toolName: event.toolName,
        success: false,
        riskLevel: assessment.level,
        summary: gated.decision.reason ?? "limit",
        errorCode: gated.decision.failureKind?.toUpperCase(),
      });
      return { block: true, reason: gated.decision.reason };
    }

    if (assessment.requiresApproval) {
      const existing = approvals.findValidApproval(
        event.toolName,
        assessment,
        (event.input ?? {}) as Record<string, unknown>,
      );
      if (!existing) {
        if (ctx.hasUI) {
          const ok = await ctx.ui.confirm(
            "IssuePilot approval",
            `${assessment.level.toUpperCase()}: ${assessment.reasons.join("; ")}`,
          );
          const pending = approvals.createPending({
            taskId,
            toolName: event.toolName,
            assessment,
            input: (event.input ?? {}) as Record<string, unknown>,
          });
          const decided = await approvals.decide(
            pending.approvalId,
            ok ? "approved" : "rejected",
            "ui",
          );
          recorder.append({
            stage,
            eventType: "approval",
            toolName: event.toolName,
            success: decided.approved,
            riskLevel: assessment.level,
            approvalId: decided.approvalId,
            summary: decided.operationSummary,
          });
          if (!decided.approved) {
            return { block: true, reason: "User rejected operation" };
          }
        } else {
          const decided = await approvals.requestApproval({
            taskId,
            toolName: event.toolName,
            assessment,
            input: (event.input ?? {}) as Record<string, unknown>,
          });
          if (decided.status === "expired") {
            runtime = recordApprovalExpired(runtime);
          }
          recorder.append({
            stage,
            eventType: "approval",
            toolName: event.toolName,
            success: decided.approved,
            riskLevel: assessment.level,
            approvalId: decided.approvalId,
            summary: decided.comment ?? decided.operationSummary,
            errorCode: decided.approved ? undefined : decided.status.toUpperCase(),
          });
          if (!decided.approved) {
            return {
              block: true,
              reason: `Approval required (${assessment.level}): ${assessment.reasons.join("; ")}`,
            };
          }
        }
      }
    }

    recorder.append({
      stage,
      eventType: "tool_call",
      toolName: event.toolName,
      success: true,
      riskLevel: assessment.level,
      summary: assessment.reasons.join("; "),
    });
  });
}
