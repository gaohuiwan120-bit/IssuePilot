---
name: safe-code-repair
description: >
  Plan and apply minimal safe code repairs for an Issue after analysis.
  Use when creating a RepairPlan or applying an approved patch.
triggers:
  - repair plan
  - safe patch
  - fix issue
  - apply fix
---

# Safe Code Repair Skill

## Required sequence

1. Generate a structured `RepairPlan` (Schema-validated).
2. Obtain Approval for medium/high risk (and always when required).
3. Create a Git Checkpoint **before** any edit.
4. Modify **only** files listed in `filesToModify`.
5. Prefer minimal diffs and add Issue-specific regression coverage when needed.

## Hard rules

- Mid/high risk operations **must** have a valid Approval.
- Checkpoint must succeed before patch.
- Never modify Pi upstream.
- Never overwrite unrelated pre-existing user dirty changes (refuse dirty worktree unless explicitly allowed).
- Never auto-Commit, Push, or create a real GitHub PR.
- Never bypass Permission Gate or Docker Executor for tests/reproduce.
- Do not delete failing tests to make validation pass.
- Do not expand scope to unplanned files.

## Forbidden

- `git commit` / `git push` / force push
- `git reset --hard` / `git clean -fd` without explicit human approval
- Editing files outside RepairPlan
- Installing dependencies with network in default policy
- Privileged Docker / docker.sock / host network
