import type { WorkflowStage } from "./stages.js";

export interface WorkflowLimits {
  maxTotalToolCalls: number;
  maxToolCallsPerStage: number;
  maxRetriesPerStage: number;
  stageTimeoutMs: number;
  duplicateCallThreshold: number;
}

export const DEFAULT_WORKFLOW_LIMITS: WorkflowLimits = {
  maxTotalToolCalls: 200,
  maxToolCallsPerStage: 40,
  maxRetriesPerStage: 3,
  stageTimeoutMs: 30 * 60 * 1000,
  duplicateCallThreshold: 3,
};

export type RuntimeFailureKind = "recoverable" | "fatal" | "blocked" | "interrupted" | "timeout";

export interface RuntimeControlState {
  stage: WorkflowStage;
  totalToolCalls: number;
  toolCallsInStage: number;
  retriesInStage: number;
  stageStartedAt: number;
  recentCallKeys: string[];
  interrupted: boolean;
  lastFailureKind?: RuntimeFailureKind;
  lastFailureReason?: string;
}

export interface RuntimeDecision {
  allow: boolean;
  reason?: string;
  failureKind?: RuntimeFailureKind;
  duplicateCount?: number;
}

export function createRuntimeState(stage: WorkflowStage, now = Date.now()): RuntimeControlState {
  return {
    stage,
    totalToolCalls: 0,
    toolCallsInStage: 0,
    retriesInStage: 0,
    stageStartedAt: now,
    recentCallKeys: [],
    interrupted: false,
  };
}

export function enterStage(
  state: RuntimeControlState,
  stage: WorkflowStage,
  now = Date.now(),
): RuntimeControlState {
  return {
    ...state,
    stage,
    toolCallsInStage: 0,
    retriesInStage: 0,
    stageStartedAt: now,
    recentCallKeys: [],
    lastFailureKind: undefined,
    lastFailureReason: undefined,
  };
}

export function markInterrupted(state: RuntimeControlState, reason: string): RuntimeControlState {
  return {
    ...state,
    interrupted: true,
    lastFailureKind: "interrupted",
    lastFailureReason: reason,
  };
}

export function recordRetry(state: RuntimeControlState, limits: WorkflowLimits): {
  state: RuntimeControlState;
  decision: RuntimeDecision;
} {
  const next = { ...state, retriesInStage: state.retriesInStage + 1 };
  if (next.retriesInStage > limits.maxRetriesPerStage) {
    return {
      state: {
        ...next,
        lastFailureKind: "fatal",
        lastFailureReason: "max retries per stage exceeded",
      },
      decision: {
        allow: false,
        reason: "max retries per stage exceeded",
        failureKind: "fatal",
      },
    };
  }
  return { state: next, decision: { allow: true } };
}

export function callKey(toolName: string, normalizedPayload: string): string {
  return `${toolName}::${normalizedPayload}`;
}

/**
 * Gate a tool call against limits, duplicates, timeout, and interrupt.
 */
export function authorizeToolCall(
  state: RuntimeControlState,
  limits: WorkflowLimits,
  key: string,
  now = Date.now(),
): { state: RuntimeControlState; decision: RuntimeDecision } {
  if (state.interrupted) {
    return {
      state,
      decision: {
        allow: false,
        reason: state.lastFailureReason ?? "user interrupted",
        failureKind: "interrupted",
      },
    };
  }
  if (now - state.stageStartedAt > limits.stageTimeoutMs) {
    return {
      state: {
        ...state,
        lastFailureKind: "timeout",
        lastFailureReason: "stage timeout",
      },
      decision: { allow: false, reason: "stage timeout", failureKind: "timeout" },
    };
  }
  if (state.totalToolCalls >= limits.maxTotalToolCalls) {
    return {
      state: {
        ...state,
        lastFailureKind: "fatal",
        lastFailureReason: "max total tool calls exceeded",
      },
      decision: {
        allow: false,
        reason: "max total tool calls exceeded",
        failureKind: "fatal",
      },
    };
  }
  if (state.toolCallsInStage >= limits.maxToolCallsPerStage) {
    return {
      state: {
        ...state,
        lastFailureKind: "recoverable",
        lastFailureReason: "max tool calls for stage exceeded",
      },
      decision: {
        allow: false,
        reason: "max tool calls for stage exceeded",
        failureKind: "recoverable",
      },
    };
  }

  const dupCount = state.recentCallKeys.filter((k) => k === key).length + 1;
  if (dupCount > limits.duplicateCallThreshold) {
    return {
      state: {
        ...state,
        lastFailureKind: "recoverable",
        lastFailureReason: "duplicate tool call threshold exceeded",
      },
      decision: {
        allow: false,
        reason: "duplicate tool call threshold exceeded",
        failureKind: "recoverable",
        duplicateCount: dupCount,
      },
    };
  }

  const recentCallKeys = [...state.recentCallKeys, key].slice(-50);
  return {
    state: {
      ...state,
      totalToolCalls: state.totalToolCalls + 1,
      toolCallsInStage: state.toolCallsInStage + 1,
      recentCallKeys,
    },
    decision: { allow: true, duplicateCount: dupCount },
  };
}

export function recordBlocked(
  state: RuntimeControlState,
  reason: string,
): RuntimeControlState {
  return {
    ...state,
    lastFailureKind: "blocked",
    lastFailureReason: reason,
  };
}

export function recordApprovalExpired(state: RuntimeControlState): RuntimeControlState {
  return {
    ...state,
    lastFailureKind: "recoverable",
    lastFailureReason: "approval expired",
  };
}
