export const WORKFLOW_PHASES = ["DISCOVER","DIAGNOSE","PLAN","APPROVE","CHECKPOINT","PATCH","VALIDATE","REPORT"] as const;
export type WorkflowPhase = (typeof WORKFLOW_PHASES)[number];
export const PHASE_TRANSITIONS: Record<WorkflowPhase, WorkflowPhase | "DONE"> = {
  DISCOVER:"DIAGNOSE", DIAGNOSE:"PLAN", PLAN:"APPROVE", APPROVE:"CHECKPOINT",
  CHECKPOINT:"PATCH", PATCH:"VALIDATE", VALIDATE:"REPORT", REPORT:"DONE",
};
export function nextPhase(current: WorkflowPhase): WorkflowPhase | "DONE" { return PHASE_TRANSITIONS[current]; }
export function isValidPhase(value: string): value is WorkflowPhase { return (WORKFLOW_PHASES as readonly string[]).includes(value); }