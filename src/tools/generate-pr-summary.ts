import type {
  DiagnosisResult,
  IssueSpec,
  PatchManifest,
  RepairPlan,
  ReviewResult,
  ValidationResult,
} from "../schema/types.js";
import { ToolRuntime } from "./context.js";

export interface GeneratePrSummaryInput {
  taskId: string;
  repositoryPath: string;
  issueSpec: IssueSpec;
  diagnosis?: DiagnosisResult | null;
  repairPlan?: RepairPlan | null;
  patchManifest?: PatchManifest | null;
  validation?: ValidationResult | null;
  review?: ReviewResult | null;
}

export interface GeneratePrSummaryResult {
  path: string;
  markdown: string;
  recommendSubmit: boolean;
}

export function generatePrSummary(input: GeneratePrSummaryInput): GeneratePrSummaryResult {
  const started = Date.now();
  const runtime = new ToolRuntime(input.taskId, input.repositoryPath, { stage: "report" });

  const issue = input.issueSpec;
  const diagnosis = input.diagnosis;
  const plan = input.repairPlan;
  const patch = input.patchManifest;
  const validation = input.validation;
  const review = input.review;

  const reviewOk = review?.recommendation === "keep_patch" && review?.issueResolved === true;
  const recommendSubmit = Boolean(reviewOk);

  const title = issue.title?.trim() || `Fix: ${issue.taskId}`;

  const lines: string[] = [];
  lines.push(`# ${title}`);
  lines.push("");

  if (!recommendSubmit) {
    lines.push("> **当前不建议提交PR**");
    if (review?.recommendation) {
      lines.push(`> Review recommendation: \`${review.recommendation}\``);
    }
    lines.push("");
  }

  lines.push("## 问题背景");
  lines.push("");
  lines.push(issue.description || issue.title || "(未提供描述)");
  if (issue.actualBehavior) {
    lines.push("");
    lines.push(`实际行为：${issue.actualBehavior}`);
  }
  if (issue.expectedBehavior) {
    lines.push("");
    lines.push(`预期行为：${issue.expectedBehavior}`);
  }
  lines.push("");

  lines.push("## 根因");
  lines.push("");
  if (!diagnosis) {
    lines.push("（未提供 DiagnosisResult）");
  } else if (
    diagnosis.verificationStatus === "unverified" ||
    diagnosis.confidence < 0.5 ||
    diagnosis.rootCauseCandidates.length > 1
  ) {
    lines.push(
      `候选原因（${diagnosis.verificationStatus}，confidence=${diagnosis.confidence}）：`,
    );
    for (const c of diagnosis.rootCauseCandidates) {
      lines.push(`- ${c}`);
    }
    if (diagnosis.summary) {
      lines.push("");
      lines.push(diagnosis.summary);
    }
  } else {
    lines.push(diagnosis.summary);
    for (const c of diagnosis.rootCauseCandidates.slice(0, 1)) {
      lines.push(`- ${c}`);
    }
  }
  lines.push("");

  lines.push("## 修改内容");
  lines.push("");
  if (!patch) {
    lines.push("（未提供 PatchManifest）");
  } else {
    const files = [
      ...patch.modifiedFiles.map((f) => `- 修改：${f}`),
      ...patch.createdFiles.map((f) => `- 新增：${f}`),
      ...patch.deletedFiles.map((f) => `- 删除：${f}`),
    ];
    lines.push(...(files.length ? files : ["（无文件变更）"]));
    lines.push("");
    lines.push(`行数：+${patch.linesAdded}/-${patch.linesDeleted}`);
    if (plan?.rootCause) {
      lines.push("");
      lines.push(`计划根因：${plan.rootCause}`);
    }
  }
  lines.push("");

  lines.push("## 测试结果");
  lines.push("");
  if (!validation) {
    lines.push("（未提供 ValidationResult）");
  } else if (!validation.executed) {
    lines.push("测试未执行；不得声称测试通过。");
  } else {
    lines.push(`- overallPassed: ${validation.overallPassed}`);
    lines.push(`- testsPassed: ${validation.testsPassed}`);
    lines.push(`- buildPassed: ${validation.buildPassed}`);
    lines.push(`- lintPassed: ${validation.lintPassed}`);
    if (validation.results?.length) {
      lines.push("");
      for (const r of validation.results) {
        lines.push(`- \`${r.command}\` exit=${r.exitCode} passed=${r.passed}`);
      }
    }
  }
  lines.push("");

  lines.push("## 验收标准");
  lines.push("");
  if (validation?.acceptanceCriteriaResults?.length) {
    for (const a of validation.acceptanceCriteriaResults) {
      lines.push(`- [${a.satisfied ? "x" : " "}] ${a.criterion}`);
    }
  } else if (issue.acceptanceCriteria?.length) {
    for (const c of issue.acceptanceCriteria) {
      lines.push(`- [ ] ${c}（验证结果未提供）`);
    }
  } else {
    lines.push("（无验收标准）");
  }
  lines.push("");

  lines.push("## 风险与限制");
  lines.push("");
  if (review?.reasons?.length) {
    for (const r of review.reasons) {
      lines.push(`- ${r}`);
    }
  } else {
    lines.push("（无额外审查发现）");
  }
  if (review?.securityRisks?.length) {
    lines.push("");
    lines.push("安全风险：");
    for (const s of review.securityRisks) lines.push(`- ${s}`);
  }
  lines.push("");

  lines.push("## 回滚方式");
  lines.push("");
  lines.push("使用 IssuePilot Git Checkpoint 回滚到 patch 前快照（不自动执行）。");
  if (patch?.baseCommit) {
    lines.push(`Base commit: \`${patch.baseCommit}\``);
  }
  if (plan?.rollbackStrategy) {
    lines.push(plan.rollbackStrategy);
  }
  lines.push("");

  const markdown = lines.join("\n");
  runtime.store.writePrSummary(markdown);
  const path = runtime.store.path("pr_summary.md");

  runtime.trace("generate_pr_summary", true, `recommendSubmit=${recommendSubmit}`, {
    durationMs: Date.now() - started,
  });

  return { path, markdown, recommendSubmit };
}
