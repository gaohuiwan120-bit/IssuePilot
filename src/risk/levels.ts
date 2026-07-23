export const RISK_LEVELS = ["low", "medium", "high"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export function isRiskLevel(value: string): value is RiskLevel {
  return (RISK_LEVELS as readonly string[]).includes(value);
}

/** Default risk associated with a workflow stage (coarse heuristic). */
export function riskForStage(stage: string): RiskLevel {
  if (stage === "patch" || stage === "checkpoint") return "medium";
  if (stage === "test" || stage === "reproduce") return "medium";
  if (stage === "approve") return "high";
  return "low";
}

export function requiresApprovalForRisk(risk: RiskLevel): boolean {
  return risk === "medium" || risk === "high";
}
