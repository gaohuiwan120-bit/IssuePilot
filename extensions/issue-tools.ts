import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  parseIssue,
  inspectRepository,
  findRelatedCode,
  diagnoseIssue,
  reproduceIssue,
  runValidation,
  collectGitDiff,
  reviewPatch,
  generatePrSummary,
  IssueToolError,
} from "../dist/tools/index.js";
import type { IssueSpec, RepairPlan, ValidationResult, DiagnosisResult, PatchManifest, ReviewResult } from "../dist/schema/types.js";

function taskIdOf(params: { taskId?: string }, ctx: { cwd: string }): string {
  return (
    params.taskId ||
    (globalThis as { __issuepilot_task_id?: string }).__issuepilot_task_id ||
    process.env.ISSUEPILOT_TASK_ID ||
    "default"
  );
}

function ok(details: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(details, null, 2) }],
    details: details as Record<string, unknown>,
  };
}

function fail(e: unknown) {
  const code = e instanceof IssueToolError ? e.code : "INVALID_INPUT";
  const message = e instanceof Error ? e.message : String(e);
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ errorCode: code, message }, null, 2) }],
    isError: true,
    details: { errorCode: code, message },
  };
}

/**
 * IssuePilot deterministic issue tools (M3A).
 * Does not advance workflow stages; does not call LLMs; does not auto-commit/push/PR.
 */
export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "parse_issue",
    label: "Parse Issue",
    description: "Deterministically parse issue text into IssueSpec",
    parameters: Type.Object({
      taskId: Type.Optional(Type.String()),
      title: Type.Optional(Type.String()),
      body: Type.String(),
      labels: Type.Optional(Type.Array(Type.String())),
      source: Type.Optional(Type.String()),
    }),
    async execute(_id, params, _s, _u, ctx) {
      try {
        const taskId = taskIdOf(params, ctx);
        const result = parseIssue(
          {
            taskId,
            title: params.title,
            body: params.body,
            labels: params.labels,
            source: params.source as "github" | "local" | "manual" | undefined,
          },
          { repositoryPath: ctx.cwd },
        );
        return ok(result);
      } catch (e) {
        return fail(e);
      }
    },
  });

  pi.registerTool({
    name: "inspect_repository",
    label: "Inspect Repository",
    description: "Scan repository inventory without executing install commands",
    parameters: Type.Object({
      taskId: Type.Optional(Type.String()),
      repositoryPath: Type.Optional(Type.String()),
    }),
    async execute(_id, params, _s, _u, ctx) {
      try {
        const taskId = taskIdOf(params, ctx);
        const result = inspectRepository({
          taskId,
          repositoryPath: params.repositoryPath || ctx.cwd,
        });
        return ok(result);
      } catch (e) {
        return fail(e);
      }
    },
  });

  pi.registerTool({
    name: "find_related_code",
    label: "Find Related Code",
    description: "Locate related files/symbols from IssueSpec using deterministic signals",
    parameters: Type.Object({
      taskId: Type.Optional(Type.String()),
      repositoryPath: Type.Optional(Type.String()),
      issueSpec: Type.Any(),
      maxResults: Type.Optional(Type.Number()),
    }),
    async execute(_id, params, _s, _u, ctx) {
      try {
        const taskId = taskIdOf(params, ctx);
        const result = findRelatedCode({
          taskId,
          repositoryPath: params.repositoryPath || ctx.cwd,
          issueSpec: params.issueSpec as IssueSpec,
          maxResults: params.maxResults,
        });
        return ok(result);
      } catch (e) {
        return fail(e);
      }
    },
  });

  pi.registerTool({
    name: "diagnose_issue",
    label: "Diagnose Issue",
    description: "Minimal deterministic diagnosis from reproduction and related code (no LLM)",
    parameters: Type.Object({
      taskId: Type.Optional(Type.String()),
      repositoryPath: Type.Optional(Type.String()),
      issueSpec: Type.Any(),
      reproduction: Type.Optional(Type.Any()),
      relatedCode: Type.Optional(Type.Any()),
    }),
    async execute(_id, params, _s, _u, ctx) {
      try {
        const taskId = taskIdOf(params, ctx);
        const result = diagnoseIssue({
          taskId,
          repositoryPath: params.repositoryPath || ctx.cwd,
          issueSpec: params.issueSpec as IssueSpec,
          reproduction: params.reproduction,
          relatedCode: params.relatedCode,
        });
        return ok(result);
      } catch (e) {
        return fail(e);
      }
    },
  });

  pi.registerTool({
    name: "reproduce_issue",
    label: "Reproduce Issue",
    description: "Run controlled reproduction commands via Docker Executor",
    parameters: Type.Object({
      taskId: Type.Optional(Type.String()),
      repositoryPath: Type.Optional(Type.String()),
      commands: Type.Array(Type.Array(Type.String())),
      expectedFailure: Type.Optional(Type.Any()),
      approvalId: Type.Optional(Type.String()),
      image: Type.Optional(Type.String()),
    }),
    async execute(_id, params, _s, _u, ctx) {
      try {
        const taskId = taskIdOf(params, ctx);
        const result = await reproduceIssue({
          taskId,
          repositoryPath: params.repositoryPath || ctx.cwd,
          commands: params.commands,
          expectedFailure: params.expectedFailure,
          approvalId: params.approvalId,
          image: params.image,
        });
        return ok(result);
      } catch (e) {
        return fail(e);
      }
    },
  });

  pi.registerTool({
    name: "run_validation",
    label: "Run Validation",
    description: "Run tests/build/lint/reproduce validation via Docker Executor",
    parameters: Type.Object({
      taskId: Type.Optional(Type.String()),
      repositoryPath: Type.Optional(Type.String()),
      testCommands: Type.Array(Type.Array(Type.String())),
      buildCommands: Type.Optional(Type.Array(Type.Array(Type.String()))),
      lintCommands: Type.Optional(Type.Array(Type.Array(Type.String()))),
      reproductionCommands: Type.Optional(Type.Array(Type.Array(Type.String()))),
      acceptanceCriteria: Type.Array(Type.String()),
      approvalId: Type.Optional(Type.String()),
      image: Type.Optional(Type.String()),
    }),
    async execute(_id, params, _s, _u, ctx) {
      try {
        const taskId = taskIdOf(params, ctx);
        const result = await runValidation({
          taskId,
          repositoryPath: params.repositoryPath || ctx.cwd,
          testCommands: params.testCommands,
          buildCommands: params.buildCommands,
          lintCommands: params.lintCommands,
          reproductionCommands: params.reproductionCommands,
          acceptanceCriteria: params.acceptanceCriteria,
          approvalId: params.approvalId,
          image: params.image,
        });
        return ok(result);
      } catch (e) {
        return fail(e);
      }
    },
  });

  pi.registerTool({
    name: "collect_git_diff",
    label: "Collect Git Diff",
    description: "Read-only git diff collection into PatchManifest (no commit/reset/clean)",
    parameters: Type.Object({
      taskId: Type.Optional(Type.String()),
      repositoryPath: Type.Optional(Type.String()),
      repairPlan: Type.Optional(Type.Any()),
    }),
    async execute(_id, params, _s, _u, ctx) {
      try {
        const taskId = taskIdOf(params, ctx);
        const result = collectGitDiff({
          taskId,
          repositoryPath: params.repositoryPath || ctx.cwd,
          repairPlan: params.repairPlan as RepairPlan | undefined,
        });
        return ok(result);
      } catch (e) {
        return fail(e);
      }
    },
  });

  pi.registerTool({
    name: "review_patch",
    label: "Review Patch",
    description: "Deterministic rule-based patch review (no LLM)",
    parameters: Type.Object({
      taskId: Type.Optional(Type.String()),
      repositoryPath: Type.Optional(Type.String()),
      issueSpec: Type.Any(),
      repairPlan: Type.Any(),
      patch: Type.Any(),
      validation: Type.Any(),
      highRiskApproved: Type.Optional(Type.Boolean()),
    }),
    async execute(_id, params, _s, _u, ctx) {
      try {
        const taskId = taskIdOf(params, ctx);
        const result = reviewPatch({
          taskId,
          repositoryPath: params.repositoryPath || ctx.cwd,
          issueSpec: params.issueSpec as IssueSpec,
          repairPlan: params.repairPlan as RepairPlan,
          patch: params.patch,
          validation: params.validation as ValidationResult,
          highRiskApproved: params.highRiskApproved,
        });
        return ok(result);
      } catch (e) {
        return fail(e);
      }
    },
  });

  pi.registerTool({
    name: "generate_pr_summary",
    label: "Generate PR Summary",
    description: "Deterministically generate pr_summary.md from structured artifacts (no GitHub PR)",
    parameters: Type.Object({
      taskId: Type.Optional(Type.String()),
      repositoryPath: Type.Optional(Type.String()),
      issueSpec: Type.Any(),
      diagnosis: Type.Optional(Type.Any()),
      repairPlan: Type.Optional(Type.Any()),
      patchManifest: Type.Optional(Type.Any()),
      validation: Type.Optional(Type.Any()),
      review: Type.Optional(Type.Any()),
    }),
    async execute(_id, params, _s, _u, ctx) {
      try {
        const taskId = taskIdOf(params, ctx);
        const result = generatePrSummary({
          taskId,
          repositoryPath: params.repositoryPath || ctx.cwd,
          issueSpec: params.issueSpec as IssueSpec,
          diagnosis: params.diagnosis as DiagnosisResult | undefined,
          repairPlan: params.repairPlan as RepairPlan | undefined,
          patchManifest: params.patchManifest as PatchManifest | undefined,
          validation: params.validation as ValidationResult | undefined,
          review: params.review as ReviewResult | undefined,
        });
        return ok(result);
      } catch (e) {
        return fail(e);
      }
    },
  });
}
