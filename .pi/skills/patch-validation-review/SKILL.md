---
name: patch-validation-review
description: >
  Validate and review patches after code changes. Use after patch application
  to run tests, review, and produce PR summary.
triggers:
  - validate patch
  - review patch
  - run tests after fix
  - pr summary
---

# Patch Validation & Review Skill

## Required sequence

1. Call `collect_git_diff` after modifications.
2. Call `run_validation` for tests / build / lint (Docker Executor).
3. Call `review_patch` for deterministic rule review.
4. If acceptance criteria unmet or required tests fail → **must not** enter Completed.
5. On retry exhaustion → safe rollback flow (restore planned files from checkpoint; no `reset --hard`).
6. Finally call `generate_pr_summary`.

## Hard rules

- Never write “tests passed” when validation was not executed.
- Never complete when `review_patch` recommends retry/rollback.
- Never weaken or delete failing tests to force green.
- Keep Run Trace and artifacts on failure.

## Outputs

- `patch_manifest.json` / `patch.diff`
- `validation.json`
- `review.json`
- `pr_summary.md`

## Forbidden

- Completing with failed validation
- Claiming success without Docker/tool evidence
- Auto Push / real PR creation
- Skipping review after patch
