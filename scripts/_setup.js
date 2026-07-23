const { mkdirSync, writeFileSync, readdirSync } = require("fs");
const { join, dirname } = require("path");
const ROOT = join(__dirname, "..");
function w(rel, c) { const p = join(ROOT, rel); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, c, "utf8"); console.log("wrote", rel); }

w("src/workflow/phases.ts", `export const WORKFLOW_PHASES = ["DISCOVER","DIAGNOSE","PLAN","APPROVE","CHECKPOINT","PATCH","VALIDATE","REPORT"] as const;
export type WorkflowPhase = (typeof WORKFLOW_PHASES)[number];
export const PHASE_TRANSITIONS = { DISCOVER:"DIAGNOSE", DIAGNOSE:"PLAN", PLAN:"APPROVE", APPROVE:"CHECKPOINT", CHECKPOINT:"PATCH", PATCH:"VALIDATE", VALIDATE:"REPORT", REPORT:"DONE" } as const;
export function nextPhase(c: WorkflowPhase) { return PHASE_TRANSITIONS[c]; }
`);

w("src/workflow/state-machine.ts", `import type { WorkflowPhase } from "./phases.js";
import { nextPhase } from "./phases.js";
export interface WorkflowState { phase: WorkflowPhase; taskId: string; startedAt: string; updatedAt: string; retryCount: number; approvalGranted?: boolean; }
export function createInitialState(taskId: string): WorkflowState { const n = new Date().toISOString(); return { phase: "DISCOVER", taskId, startedAt: n, updatedAt: n, retryCount: 0 }; }
export function advance(state: WorkflowState) {
  if (state.phase === "APPROVE" && !state.approvalGranted) return { state, advanced: false, reason: "Approval required" };
  const nxt = nextPhase(state.phase);
  if (nxt === "DONE") return { state, advanced: false, reason: "Complete" };
  return { state: { ...state, phase: nxt, updatedAt: new Date().toISOString() }, advanced: true };
}
`);

w("src/risk/levels.ts", `export type RiskLevel = "READ_ONLY"|"DIAGNOSTIC"|"CONTROLLED_PATCH"|"CONTAINER_EXEC"|"DESTRUCTIVE";
export function riskForPhase(p: string): RiskLevel {
  if (p==="VALIDATE") return "CONTAINER_EXEC";
  if (p==="PATCH"||p==="CHECKPOINT") return "CONTROLLED_PATCH";
  if (p==="DIAGNOSE"||p==="PLAN") return "DIAGNOSTIC";
  return "READ_ONLY";
}
`);

w("src/schema/types.ts", `export interface TaskSpec { id: string; title: string; repoPath: string; goal: string; createdAt: string; }
export interface DiagnosisResult { taskId: string; errors: {category:string;message:string}[]; diagnosedAt: string; }
export interface RepairPlan { taskId: string; summary: string; steps: {id:string;action:string}[]; plannedAt: string; }
export interface ValidationResult { taskId: string; testsPassed: boolean; smokePassed: boolean; validatedAt: string; }
`);

w("src/artifacts/store.ts", `import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
export class ArtifactStore {
  constructor(private root: string) { mkdirSync(root, { recursive: true }); }
  writeJson(name: string, data: unknown) { writeFileSync(join(this.root, name), JSON.stringify(data, null, 2)); }
  readJson(name: string) { const p = join(this.root, name); return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : undefined; }
}
export function defaultArtifactDir(cwd: string) { return join(cwd, ".mlpilot", "artifacts"); }
`);

w("src/index.ts", `export * from "./workflow/phases.js";\nexport * from "./workflow/state-machine.js";\nexport * from "./risk/levels.js";\nexport * from "./schema/types.js";\nexport * from "./artifacts/store.js";\n`);

console.log("core done");