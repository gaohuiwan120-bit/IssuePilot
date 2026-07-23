import type { ArtifactName } from "../artifacts/names.js";
import type { RiskLevel } from "../risk/levels.js";

export const WORKFLOW_STAGES = [
  "understand",
  "inspect",
  "reproduce",
  "diagnose",
  "plan",
  "approve",
  "checkpoint",
  "patch",
  "test",
  "review",
  "report",
  "completed",
  "rolled_back",
  "failed",
] as const;

export type WorkflowStage = (typeof WORKFLOW_STAGES)[number];

export const ACTIVE_STAGES = [
  "understand",
  "inspect",
  "reproduce",
  "diagnose",
  "plan",
  "approve",
  "checkpoint",
  "patch",
  "test",
  "review",
  "report",
] as const;

export type ActiveStage = (typeof ACTIVE_STAGES)[number];

export const TERMINAL_STAGES = ["completed", "rolled_back", "failed"] as const;
export type TerminalStage = (typeof TERMINAL_STAGES)[number];

export const STAGE_TRANSITIONS: Record<ActiveStage, WorkflowStage> = {
  understand: "inspect",
  inspect: "reproduce",
  reproduce: "diagnose",
  diagnose: "plan",
  plan: "approve",
  approve: "checkpoint",
  checkpoint: "patch",
  patch: "test",
  test: "review",
  review: "report",
  report: "completed",
};

export interface StagePolicy {
  stage: ActiveStage;
  allowedPredecessors: WorkflowStage[];
  requiredArtifacts: ArtifactName[];
  requiresHumanConfirmation: boolean;
  retryable: boolean;
  maxRetries: number;
  failureTarget: TerminalStage | ActiveStage;
}

export const STAGE_POLICIES: Record<ActiveStage, StagePolicy> = {
  understand: {
    stage: "understand",
    allowedPredecessors: [],
    requiredArtifacts: [],
    requiresHumanConfirmation: false,
    retryable: true,
    maxRetries: 2,
    failureTarget: "failed",
  },
  inspect: {
    stage: "inspect",
    allowedPredecessors: ["understand"],
    requiredArtifacts: ["issue_spec.json"],
    requiresHumanConfirmation: false,
    retryable: true,
    maxRetries: 1,
    failureTarget: "failed",
  },
  reproduce: {
    stage: "reproduce",
    allowedPredecessors: ["inspect"],
    requiredArtifacts: ["repository_inventory.json"],
    requiresHumanConfirmation: false,
    retryable: true,
    maxRetries: 2,
    failureTarget: "failed",
  },
  diagnose: {
    stage: "diagnose",
    allowedPredecessors: ["reproduce"],
    requiredArtifacts: ["reproduction.json"],
    requiresHumanConfirmation: false,
    retryable: true,
    maxRetries: 2,
    failureTarget: "failed",
  },
  plan: {
    stage: "plan",
    allowedPredecessors: ["diagnose"],
    requiredArtifacts: ["diagnosis.json"],
    requiresHumanConfirmation: false,
    retryable: true,
    maxRetries: 2,
    failureTarget: "failed",
  },
  approve: {
    stage: "approve",
    allowedPredecessors: ["plan"],
    requiredArtifacts: ["repair_plan.json"],
    requiresHumanConfirmation: true,
    retryable: false,
    maxRetries: 0,
    failureTarget: "failed",
  },
  checkpoint: {
    stage: "checkpoint",
    allowedPredecessors: ["approve"],
    requiredArtifacts: ["approval.json"],
    requiresHumanConfirmation: false,
    retryable: true,
    maxRetries: 1,
    failureTarget: "failed",
  },
  patch: {
    stage: "patch",
    allowedPredecessors: ["checkpoint"],
    requiredArtifacts: [],
    requiresHumanConfirmation: false,
    retryable: true,
    maxRetries: 1,
    failureTarget: "rolled_back",
  },
  test: {
    stage: "test",
    allowedPredecessors: ["patch"],
    requiredArtifacts: ["patch_manifest.json"],
    requiresHumanConfirmation: false,
    retryable: true,
    maxRetries: 3,
    failureTarget: "rolled_back",
  },
  review: {
    stage: "review",
    allowedPredecessors: ["test"],
    requiredArtifacts: ["validation.json"],
    requiresHumanConfirmation: false,
    retryable: true,
    maxRetries: 1,
    failureTarget: "failed",
  },
  report: {
    stage: "report",
    allowedPredecessors: ["review"],
    requiredArtifacts: ["review.json"],
    requiresHumanConfirmation: false,
    retryable: false,
    maxRetries: 0,
    failureTarget: "failed",
  },
};

export function isValidStage(value: string): value is WorkflowStage {
  return (WORKFLOW_STAGES as readonly string[]).includes(value);
}

export function isActiveStage(value: string): value is ActiveStage {
  return (ACTIVE_STAGES as readonly string[]).includes(value);
}

export function isTerminalStage(value: string): value is TerminalStage {
  return (TERMINAL_STAGES as readonly string[]).includes(value);
}

export function nextStage(current: ActiveStage): WorkflowStage {
  return STAGE_TRANSITIONS[current];
}

export function stagePolicy(stage: ActiveStage): StagePolicy {
  return STAGE_POLICIES[stage];
}

/** Risk levels that block checkpoint without approval. */
export function planNeedsApproval(risk: RiskLevel): boolean {
  return risk === "medium" || risk === "high";
}
