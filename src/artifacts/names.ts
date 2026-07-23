export const ARTIFACT_NAMES = [
  "issue_spec.json",
  "repository_inventory.json",
  "reproduction.json",
  "diagnosis.json",
  "repair_plan.json",
  "approval.json",
  "patch_manifest.json",
  "patch.diff",
  "validation.json",
  "review.json",
  "run_trace.jsonl",
  "pr_summary.md",
] as const;

export type ArtifactName = (typeof ARTIFACT_NAMES)[number];

/** Artifacts that must exist before a later stage may start (see stage policies). */
export const REQUIRED_ARTIFACTS = [
  "issue_spec.json",
  "repository_inventory.json",
  "reproduction.json",
  "diagnosis.json",
  "repair_plan.json",
  "approval.json",
  "patch_manifest.json",
  "validation.json",
  "review.json",
] as const satisfies readonly ArtifactName[];

/** May be absent without breaking store listing / partial reads. */
export const OPTIONAL_ARTIFACTS = [
  "patch.diff",
  "run_trace.jsonl",
  "pr_summary.md",
] as const satisfies readonly ArtifactName[];

export function isArtifactName(value: string): value is ArtifactName {
  return (ARTIFACT_NAMES as readonly string[]).includes(value);
}

export function isOptionalArtifact(name: ArtifactName): boolean {
  return (OPTIONAL_ARTIFACTS as readonly ArtifactName[]).includes(name);
}

/**
 * Task ids used as directory names under outputs/.
 * Allows letters, digits, underscore, hyphen, dot; rejects path separators and `..`.
 */
export function assertValidTaskId(taskId: string): void {
  if (!taskId || typeof taskId !== "string") {
    throw new Error("taskId is required");
  }
  if (taskId.includes("\0")) {
    throw new Error("taskId contains NUL");
  }
  if (taskId.includes("..") || taskId.includes("/") || taskId.includes("\\")) {
    throw new Error(`invalid taskId (path traversal): ${taskId}`);
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(taskId)) {
    throw new Error(`invalid taskId format: ${taskId}`);
  }
}
