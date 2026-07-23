import type { WorkflowPhase } from "../workflow/phases.js";
import type { RiskLevel } from "../risk/levels.js";

export interface TaskSpec { id: string; title: string; repoPath: string; goal: string; createdAt: string; }
export interface ProjectInventory { taskId: string; framework?: "pytorch" | "unknown"; entryPoints: string[]; configFiles: string[]; hasRequirements: boolean; hasTests: boolean; scannedAt: string; }
export interface DiagnosisResult { taskId: string; errors: Array<{ category: string; message: string }>; tensorIssues: Array<{ kind: string; detail: string }>; instabilitySignals: string[]; environmentIssues: string[]; diagnosedAt: string; }
export interface RepairPlan { taskId: string; summary: string; steps: Array<{ id: string; action: string; risk: RiskLevel }>; plannedAt: string; }
export interface ApprovalDecision { taskId: string; approved: boolean; decidedAt: string; }
export interface PatchManifest { taskId: string; filesChanged: string[]; patchedAt: string; }
export interface ValidationResult { taskId: string; testsPassed: boolean; smokePassed: boolean; validatedAt: string; }
export interface WorkflowSnapshot { taskId: string; phase: WorkflowPhase; artifacts: Record<string, string>; }