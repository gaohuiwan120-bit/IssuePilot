export const RISK_LEVELS = ["low", "medium", "high", "blocked"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

/** Risk levels allowed on RepairPlan (never blocked). */
export type PlanRiskLevel = Exclude<RiskLevel, "blocked">;

export const PLAN_RISK_LEVELS = ["low", "medium", "high"] as const;

export function isRiskLevel(value: string): value is RiskLevel {
  return (RISK_LEVELS as readonly string[]).includes(value);
}

export function isPlanRiskLevel(value: string): value is PlanRiskLevel {
  return (PLAN_RISK_LEVELS as readonly string[]).includes(value);
}

/** Default risk associated with a workflow stage (coarse heuristic). */
export function riskForStage(stage: string): PlanRiskLevel {
  if (stage === "patch" || stage === "checkpoint") return "medium";
  if (stage === "test" || stage === "reproduce") return "medium";
  if (stage === "approve") return "high";
  return "low";
}

export function requiresApprovalForRisk(risk: RiskLevel): boolean {
  return risk === "medium" || risk === "high";
}
