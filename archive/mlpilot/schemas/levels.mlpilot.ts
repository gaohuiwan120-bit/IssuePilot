export const RISK_LEVELS = ["READ_ONLY","DIAGNOSTIC","CONTROLLED_PATCH","CONTAINER_EXEC","DESTRUCTIVE"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];
export function riskForPhase(phase: string): RiskLevel {
  if (phase === "VALIDATE") return "CONTAINER_EXEC";
  if (phase === "PATCH" || phase === "CHECKPOINT") return "CONTROLLED_PATCH";
  if (phase === "DIAGNOSE" || phase === "PLAN") return "DIAGNOSTIC";
  return "READ_ONLY";
}