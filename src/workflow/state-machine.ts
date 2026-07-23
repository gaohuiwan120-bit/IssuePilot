import type { ArtifactName } from "../artifacts/names.js";
import type { PlanRiskLevel } from "../risk/levels.js";
import {
  type ActiveStage,
  type StagePolicy,
  type WorkflowStage,
  isActiveStage,
  isTerminalStage,
  nextStage,
  planNeedsApproval,
  stagePolicy,
} from "./stages.js";

export interface WorkflowState {
  stage: WorkflowStage;
  taskId: string;
  startedAt: string;
  updatedAt: string;
  retryCount: number;
  /** Artifacts known to exist for this task. */
  presentArtifacts: ArtifactName[];
  approvalGranted: boolean;
  planRiskLevel: PlanRiskLevel | null;
  checkpointCreated: boolean;
  patchProduced: boolean;
  validationExecuted: boolean;
  reviewPassed: boolean;
  /** Reproduction recorded as unsuccessful but with explicit exception. */
  unreproducibleException: boolean;
  lastError?: string;
}

export interface TransitionResult {
  state: WorkflowState;
  advanced: boolean;
  reason?: string;
}

export function createInitialState(taskId: string): WorkflowState {
  const now = new Date().toISOString();
  return {
    stage: "understand",
    taskId,
    startedAt: now,
    updatedAt: now,
    retryCount: 0,
    presentArtifacts: [],
    approvalGranted: false,
    planRiskLevel: null,
    checkpointCreated: false,
    patchProduced: false,
    validationExecuted: false,
    reviewPassed: false,
    unreproducibleException: false,
  };
}

export function markArtifact(state: WorkflowState, name: ArtifactName): WorkflowState {
  if (state.presentArtifacts.includes(name)) return state;
  return {
    ...state,
    presentArtifacts: [...state.presentArtifacts, name],
    updatedAt: new Date().toISOString(),
  };
}

export function setPlanRisk(state: WorkflowState, risk: PlanRiskLevel): WorkflowState {
  return {
    ...state,
    planRiskLevel: risk,
    updatedAt: new Date().toISOString(),
  };
}

export function grantApproval(state: WorkflowState, granted: boolean): WorkflowState {
  return {
    ...state,
    approvalGranted: granted,
    updatedAt: new Date().toISOString(),
  };
}

export function markCheckpointCreated(state: WorkflowState): WorkflowState {
  return { ...state, checkpointCreated: true, updatedAt: new Date().toISOString() };
}

export function markPatchProduced(state: WorkflowState): WorkflowState {
  let next = { ...state, patchProduced: true, updatedAt: new Date().toISOString() };
  if (!next.presentArtifacts.includes("patch_manifest.json")) {
    next = markArtifact(next, "patch_manifest.json");
  }
  return next;
}

export function markValidationExecuted(state: WorkflowState, passed: boolean): WorkflowState {
  let next: WorkflowState = {
    ...state,
    validationExecuted: true,
    updatedAt: new Date().toISOString(),
  };
  if (!next.presentArtifacts.includes("validation.json")) {
    next = markArtifact(next, "validation.json");
  }
  if (!passed) {
    next = { ...next, lastError: "validation failed" };
  }
  return next;
}

export function markReviewResult(state: WorkflowState, passed: boolean): WorkflowState {
  let next: WorkflowState = {
    ...state,
    reviewPassed: passed,
    updatedAt: new Date().toISOString(),
  };
  if (!next.presentArtifacts.includes("review.json")) {
    next = markArtifact(next, "review.json");
  }
  return next;
}

export function markReproduction(
  state: WorkflowState,
  opts: { reproduced: boolean; unreproducibleException?: boolean },
): WorkflowState {
  let next = markArtifact(state, "reproduction.json");
  next = {
    ...next,
    unreproducibleException: Boolean(opts.unreproducibleException),
    updatedAt: new Date().toISOString(),
  };
  if (!opts.reproduced && !opts.unreproducibleException) {
    next = {
      ...next,
      lastError: "reproduction failed without exception record",
    };
  }
  return next;
}

function hasArtifact(state: WorkflowState, name: ArtifactName): boolean {
  return state.presentArtifacts.includes(name);
}

function missingRequired(state: WorkflowState, required: readonly ArtifactName[]): ArtifactName[] {
  return required.filter((a) => !hasArtifact(state, a));
}

/**
 * Validates whether the workflow may leave `from` and enter `to`
 * (typically the configured next stage).
 */
export function canTransition(state: WorkflowState, to: WorkflowStage): TransitionResult {
  if (isTerminalStage(state.stage)) {
    return { state, advanced: false, reason: `terminal stage: ${state.stage}` };
  }
  if (!isActiveStage(state.stage)) {
    return { state, advanced: false, reason: `not an active stage: ${state.stage}` };
  }

  const policy = stagePolicy(state.stage);
  const expected = nextStage(state.stage);
  if (to !== expected && !isTerminalStage(to)) {
    return {
      state,
      advanced: false,
      reason: `invalid transition ${state.stage} -> ${to} (expected ${expected})`,
    };
  }

  // Gate: artifacts required to ENTER the destination active stage
  if (isActiveStage(to)) {
    const enterPolicy = stagePolicy(to);
    const missing = missingRequired(state, enterPolicy.requiredArtifacts);
    if (missing.length > 0) {
      return {
        state,
        advanced: false,
        reason: `missing artifacts for ${to}: ${missing.join(", ")}`,
      };
    }
  }

  // Hard gates beyond simple requiredArtifacts lists
  if (to === "diagnose") {
    if (!hasArtifact(state, "reproduction.json")) {
      return { state, advanced: false, reason: "missing artifacts for diagnose: reproduction.json" };
    }
  }

  if (to === "plan") {
    if (!hasArtifact(state, "diagnosis.json")) {
      return { state, advanced: false, reason: "missing artifacts for plan: diagnosis.json" };
    }
  }

  if (to === "checkpoint") {
    if (!state.approvalGranted) {
      const risk = state.planRiskLevel;
      if (risk === null || planNeedsApproval(risk)) {
        return {
          state,
          advanced: false,
          reason: "medium/high risk plan requires approval before checkpoint",
        };
      }
    }
  }

  if (to === "patch") {
    if (!state.checkpointCreated) {
      return { state, advanced: false, reason: "checkpoint required before patch" };
    }
  }

  if (to === "test") {
    if (!state.patchProduced || !hasArtifact(state, "patch_manifest.json")) {
      return { state, advanced: false, reason: "patch required before test" };
    }
  }

  if (to === "review") {
    if (!state.validationExecuted || !hasArtifact(state, "validation.json")) {
      return { state, advanced: false, reason: "validation must be executed before review" };
    }
  }

  if (to === "completed") {
    if (!state.reviewPassed) {
      return { state, advanced: false, reason: "review must pass before completed" };
    }
    if (!hasArtifact(state, "review.json")) {
      return { state, advanced: false, reason: "missing artifacts for completed: review.json" };
    }
  }

  return { state, advanced: true };
}

export function advance(state: WorkflowState): TransitionResult {
  if (isTerminalStage(state.stage)) {
    return { state, advanced: false, reason: `terminal stage: ${state.stage}` };
  }
  if (!isActiveStage(state.stage)) {
    return { state, advanced: false, reason: `cannot advance from ${state.stage}` };
  }

  // Leaving approve without grant
  if (state.stage === "approve" && !state.approvalGranted) {
    const risk = state.planRiskLevel;
    if (risk === null || planNeedsApproval(risk)) {
      return { state, advanced: false, reason: "Approval required" };
    }
  }

  // Leaving reproduce: need reproduction.json and either success or documented exception
  if (state.stage === "reproduce") {
    if (!hasArtifact(state, "reproduction.json")) {
      return { state, advanced: false, reason: "missing artifacts for diagnose: reproduction.json" };
    }
  }

  const dest = nextStage(state.stage);
  const check = canTransition(state, dest);
  if (!check.advanced) return check;

  return {
    state: {
      ...state,
      stage: dest,
      updatedAt: new Date().toISOString(),
      lastError: undefined,
    },
    advanced: true,
  };
}

/** Attempt to enter a stage (used for illegal jump tests). */
export function attemptEnter(state: WorkflowState, target: WorkflowStage): TransitionResult {
  if (isTerminalStage(state.stage)) {
    return { state, advanced: false, reason: `terminal stage: ${state.stage}` };
  }
  if (isActiveStage(target)) {
    const policy: StagePolicy = stagePolicy(target);
    if (
      policy.allowedPredecessors.length > 0 &&
      !policy.allowedPredecessors.includes(state.stage)
    ) {
      return {
        state,
        advanced: false,
        reason: `invalid predecessor for ${target}: ${state.stage}`,
      };
    }
    const missing = missingRequired(state, policy.requiredArtifacts);
    if (missing.length > 0) {
      return {
        state,
        advanced: false,
        reason: `missing artifacts for ${target}: ${missing.join(", ")}`,
      };
    }
  }

  if (target === "patch" && !state.checkpointCreated) {
    return { state, advanced: false, reason: "checkpoint required before patch" };
  }
  if (target === "test" && !state.patchProduced) {
    return { state, advanced: false, reason: "patch required before test" };
  }
  if (target === "review" && !state.validationExecuted) {
    return { state, advanced: false, reason: "validation must be executed before review" };
  }
  if (target === "completed" && !state.reviewPassed) {
    return { state, advanced: false, reason: "review must pass before completed" };
  }
  if (target === "diagnose" && !hasArtifact(state, "reproduction.json")) {
    return { state, advanced: false, reason: "missing artifacts for diagnose: reproduction.json" };
  }
  if (target === "plan" && !hasArtifact(state, "diagnosis.json")) {
    return { state, advanced: false, reason: "missing artifacts for plan: diagnosis.json" };
  }

  return {
    state: { ...state, stage: target, updatedAt: new Date().toISOString() },
    advanced: true,
  };
}

export function retryFromTest(state: WorkflowState): TransitionResult {
  if (state.stage !== "test" && state.stage !== "review") {
    return { state, advanced: false, reason: "retry only from test/review" };
  }
  const policy = stagePolicy("test");
  if (state.retryCount >= policy.maxRetries) {
    return {
      state: {
        ...state,
        stage: policy.failureTarget,
        updatedAt: new Date().toISOString(),
        lastError: "Max retries exceeded",
      },
      advanced: false,
      reason: "Max retries — moved to " + policy.failureTarget,
    };
  }
  return {
    state: {
      ...state,
      stage: "diagnose",
      retryCount: state.retryCount + 1,
      validationExecuted: false,
      reviewPassed: false,
      updatedAt: new Date().toISOString(),
    },
    advanced: true,
  };
}

export function fail(state: WorkflowState, reason: string): TransitionResult {
  return {
    state: {
      ...state,
      stage: "failed",
      lastError: reason,
      updatedAt: new Date().toISOString(),
    },
    advanced: true,
    reason,
  };
}

export function rollback(state: WorkflowState, reason: string): TransitionResult {
  return {
    state: {
      ...state,
      stage: "rolled_back",
      lastError: reason,
      updatedAt: new Date().toISOString(),
    },
    advanced: true,
    reason,
  };
}

export function stageIndex(stage: WorkflowStage): number {
  const order = [
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
  return order.indexOf(stage as (typeof order)[number]);
}
