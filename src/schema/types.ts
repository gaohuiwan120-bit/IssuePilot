import type { PlanRiskLevel } from "../risk/levels.js";

export type IssueType = "bug" | "feature" | "refactor" | "test" | "documentation";

export type VerificationStatus =
  | "verified"
  | "partially_verified"
  | "unverified"
  | "conflicting";

export type ReviewRecommendation = "keep_patch" | "retry" | "rollback";

export type ApprovalStatus = "approved" | "rejected" | "expired" | "pending";

export interface IssueSpec {
  taskId: string;
  title: string;
  issueType: IssueType;
  description: string;
  expectedBehavior: string | null;
  actualBehavior: string | null;
  reproductionSteps: string[];
  acceptanceCriteria: string[];
  mentionedFiles: string[];
  mentionedSymbols: string[];
  missingInformation: string[];
}

export interface RepositoryInventory {
  taskId: string;
  projectType: string;
  languages: string[];
  frameworks: string[];
  packageManagers: string[];
  entryPoints: string[];
  sourceDirectories: string[];
  testDirectories: string[];
  buildCommands: string[];
  testCommands: string[];
  lintCommands: string[];
  gitStatus: string;
}

export interface ReproductionResult {
  taskId: string;
  reproduced: boolean;
  commands: string[];
  exitCodes: number[];
  observedBehavior: string;
  logs: string[];
  failingTests: string[];
  failureReason: string | null;
  reproductionConfidence: number;
  unreproducibleException?: boolean;
  exceptionEvidence?: string[];
}

export interface DiagnosisResult {
  taskId: string;
  summary: string;
  rootCauseCandidates: string[];
  evidence: string[];
  suspectedFiles: string[];
  suspectedSymbols: string[];
  callChain: string[];
  confidence: number;
  verificationStatus: VerificationStatus;
  missingEvidence: string[];
}

export interface PlannedChange {
  file: string;
  description: string;
  reason: string;
}

export interface RepairPlan {
  taskId: string;
  rootCause: string;
  evidence: string[];
  filesToModify: string[];
  plannedChanges: PlannedChange[];
  validationCommands: string[];
  acceptanceCriteria: string[];
  rollbackStrategy: string;
  riskLevel: PlanRiskLevel;
  requiresApproval: boolean;
}

/** Operation-bound approval record (M2A). */
export interface ApprovalDecision {
  taskId: string;
  approvalId: string;
  approved: boolean;
  status: ApprovalStatus;
  approvedBy: string | null;
  approvedAt: string | null;
  expiresAt: string | null;
  /** Stable hash of tool + normalized operation + params. */
  operationHash: string;
  operationSummary: string;
  approvedActions: string[];
  rejectedActions: string[];
  comment: string | null;
}

export interface PatchManifest {
  taskId: string;
  baseCommit: string | null;
  branch: string | null;
  worktree: string | null;
  modifiedFiles: string[];
  createdFiles: string[];
  deletedFiles: string[];
  linesAdded: number;
  linesDeleted: number;
  patchPath: string | null;
}

export interface CommandResult {
  command: string;
  exitCode: number;
  passed: boolean;
  durationMs?: number;
  outputSummary?: string;
}

export interface ValidationResult {
  taskId: string;
  commands: string[];
  results: CommandResult[];
  buildPassed: boolean;
  lintPassed: boolean;
  testsPassed: boolean;
  reproductionTestPassed: boolean;
  regressionTestsPassed: boolean;
  acceptanceCriteriaResults: Array<{ criterion: string; satisfied: boolean }>;
  overallPassed: boolean;
  executed: boolean;
}

export interface ReviewResult {
  taskId: string;
  issueResolved: boolean;
  unrelatedChanges: boolean;
  potentialRegressions: string[];
  securityRisks: string[];
  missingTests: boolean;
  acceptanceCriteriaSatisfied: boolean;
  recommendation: ReviewRecommendation;
  reasons: string[];
}

export interface WorkflowSnapshot {
  taskId: string;
  stage: import("../workflow/stages.js").WorkflowStage;
  artifacts: Partial<Record<string, string>>;
  updatedAt: string;
}
