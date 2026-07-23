import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  RISK_LEVELS,
  isRiskLevel,
} from "../dist/risk/levels.js";
import {
  WORKFLOW_STAGES,
  STAGE_POLICIES,
  isValidStage,
} from "../dist/workflow/stages.js";
import { ARTIFACT_NAMES, REQUIRED_ARTIFACTS, OPTIONAL_ARTIFACTS } from "../dist/artifacts/names.js";

describe("IssuePilot schema contracts", () => {
  it("exports risk low|medium|high|blocked", () => {
    assert.deepEqual([...RISK_LEVELS], ["low", "medium", "high", "blocked"]);
    assert.equal(isRiskLevel("high"), true);
    assert.equal(isRiskLevel("blocked"), true);
    assert.equal(isRiskLevel("DESTRUCTIVE"), false);
  });

  it("defines full WorkflowStage set including diagnose and terminals", () => {
    for (const s of [
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
    ]) {
      assert.equal(isValidStage(s), true, s);
    }
    assert.ok(WORKFLOW_STAGES.includes("diagnose"));
    assert.ok(STAGE_POLICIES.diagnose.requiredArtifacts.includes("reproduction.json"));
    assert.ok(STAGE_POLICIES.plan.requiredArtifacts.includes("diagnosis.json"));
  });

  it("lists IssuePilot artifacts with required/optional split", () => {
    assert.ok(ARTIFACT_NAMES.includes("issue_spec.json"));
    assert.ok(ARTIFACT_NAMES.includes("reproduction.json"));
    assert.ok(ARTIFACT_NAMES.includes("diagnosis.json"));
    assert.ok(ARTIFACT_NAMES.includes("review.json"));
    assert.ok(ARTIFACT_NAMES.includes("pr_summary.md"));
    assert.ok(REQUIRED_ARTIFACTS.includes("diagnosis.json"));
    assert.ok(OPTIONAL_ARTIFACTS.includes("patch.diff"));
  });
});
