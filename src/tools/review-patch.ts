import type {
  IssueSpec,
  RepairPlan,
  ReviewResult,
  ReviewRecommendation,
  ValidationResult,
} from "../schema/types.js";
import type { CollectGitDiffResult } from "./collect-git-diff.js";
import { ToolRuntime } from "./context.js";

export interface ReviewPatchInput {
  taskId: string;
  repositoryPath: string;
  issueSpec: IssueSpec;
  repairPlan: RepairPlan;
  patch: CollectGitDiffResult;
  validation: ValidationResult;
  /** Explicit approval for high-risk changes (lockfile/deps/deletes). */
  highRiskApproved?: boolean;
}

export function reviewPatch(input: ReviewPatchInput): ReviewResult {
  const started = Date.now();
  const runtime = new ToolRuntime(input.taskId, input.repositoryPath, { stage: "review" });

  const reasons: string[] = [];
  const potentialRegressions: string[] = [];
  const securityRisks: string[] = [];
  let hardGateFailed = false;
  let recommendRollback = false;

  const patch = input.patch;
  const validation = input.validation;
  const plan = input.repairPlan;
  const unrelatedChanges = patch.unrelatedFiles.length > 0;

  if (unrelatedChanges) {
    reasons.push(`Unplanned files changed: ${patch.unrelatedFiles.join(", ")}`);
    potentialRegressions.push(...patch.unrelatedFiles);
    hardGateFailed = true;
    if (!input.highRiskApproved) recommendRollback = true;
  }

  if (patch.hasLockfileChanges) {
    reasons.push("Lockfile or dependency lock changes detected");
    securityRisks.push("lockfile-change");
    if (!input.highRiskApproved) {
      hardGateFailed = true;
      recommendRollback = true;
    }
  }

  const totalLines = patch.manifest.linesAdded + patch.manifest.linesDeleted;
  if (totalLines > 500) {
    reasons.push(`Large diff: +${patch.manifest.linesAdded}/-${patch.manifest.linesDeleted} lines`);
    potentialRegressions.push("large-diff");
  }

  if (patch.manifest.deletedFiles.length > 0) {
    reasons.push(`Deleted files: ${patch.manifest.deletedFiles.join(", ")}`);
    if (!input.highRiskApproved) {
      hardGateFailed = true;
      recommendRollback = true;
    }
  }

  const hasTestChanges = [...patch.manifest.modifiedFiles, ...patch.manifest.createdFiles].some(
    (f) =>
      /(^|\/)(test|tests|__tests__)\//.test(f) ||
      /\.(test|spec)\.[jt]sx?$/.test(f) ||
      /_test\.py$/.test(f) ||
      /test_.*\.py$/.test(f),
  );

  const missingTests = !hasTestChanges && input.issueSpec.issueType === "bug";
  if (missingTests) {
    reasons.push("No test file changes detected for a bug fix");
  }

  if (!validation.executed) {
    reasons.push("Validation was not executed; cannot recommend keep");
    hardGateFailed = true;
  } else if (!validation.testsPassed) {
    reasons.push("Required tests failed");
    hardGateFailed = true;
  }

  if (validation.executed && !validation.overallPassed) {
    reasons.push("Overall validation did not pass");
    hardGateFailed = true;
  }

  const unsatisfied = (validation.acceptanceCriteriaResults ?? []).filter((a) => !a.satisfied);
  const acceptanceCriteriaSatisfied = unsatisfied.length === 0;
  if (!acceptanceCriteriaSatisfied) {
    reasons.push(
      `Acceptance criteria not met: ${unsatisfied.map((a) => a.criterion).join("; ")}`,
    );
    hardGateFailed = true;
  }

  if (patch.hasSensitiveFiles) {
    reasons.push("Sensitive files were modified");
    securityRisks.push("sensitive-file");
    hardGateFailed = true;
    recommendRollback = true;
  }

  if (patch.hasOutsideRepoPaths) {
    reasons.push("Paths outside repository detected in diff");
    securityRisks.push("outside-repo-path");
    hardGateFailed = true;
    recommendRollback = true;
  }

  if (plan.requiresApproval && !input.highRiskApproved && plan.riskLevel !== "low") {
    reasons.push("High-risk plan changes were not approved");
    hardGateFailed = true;
    recommendRollback = true;
  }

  let recommendation: ReviewRecommendation;
  if (recommendRollback || patch.hasSensitiveFiles) {
    recommendation = "rollback";
  } else if (hardGateFailed) {
    recommendation = "retry";
  } else {
    recommendation = "keep_patch";
  }

  if (hardGateFailed && recommendation === "keep_patch") {
    recommendation = "retry";
  }

  const issueResolved =
    recommendation === "keep_patch" &&
    validation.executed &&
    validation.overallPassed &&
    acceptanceCriteriaSatisfied &&
    !hardGateFailed;

  const result: ReviewResult = {
    taskId: input.taskId,
    issueResolved,
    unrelatedChanges,
    potentialRegressions,
    securityRisks,
    missingTests,
    acceptanceCriteriaSatisfied,
    recommendation,
    reasons,
  };

  runtime.store.writeJson("review.json", result);
  runtime.trace("review_patch", recommendation === "keep_patch", `recommendation=${recommendation}`, {
    durationMs: Date.now() - started,
  });
  return result;
}
