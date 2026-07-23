/** @deprecated Use stages.ts — kept as a thin re-export for transitional imports. */
export {
  WORKFLOW_STAGES as WORKFLOW_PHASES,
  type WorkflowStage as WorkflowPhase,
  STAGE_TRANSITIONS as PHASE_TRANSITIONS,
  nextStage as nextPhase,
  isValidStage as isValidPhase,
  WORKFLOW_STAGES,
  STAGE_TRANSITIONS,
  nextStage,
  isValidStage,
  type WorkflowStage,
} from "./stages.js";
