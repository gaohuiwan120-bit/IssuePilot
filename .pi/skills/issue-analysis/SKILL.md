---
name: issue-analysis
description: >
  Analyze GitHub-style issues deterministically. Use when understanding, inspecting,
  reproducing, or diagnosing a software Issue before any code change.
triggers:
  - issue analysis
  - reproduce bug
  - diagnose issue
  - understand issue
---

# Issue Analysis Skill

## Required tool order

1. Call `parse_issue` first.
2. Call `inspect_repository`.
3. Call `find_related_code` using the IssueSpec.
4. Call `reproduce_issue` with expected failure signatures.
5. Call `diagnose_issue` only after reproduction evidence exists.

## Hard rules

- If reproduction fails (not reproduced / blocked / timeout / insufficient evidence), **do not** claim the bug is confirmed.
- Diagnosis must mark uncertain content as **unverified** / low confidence.
- Do not invent reproduction steps or acceptance criteria missing from the Issue.
- Do not advance Workflow Stage yourself — Workflow Controller owns transitions.
- Do not call LLM from tools; tools are deterministic.

## Outputs

- `issue_spec.json`
- `repository_inventory.json`
- `reproduction.json`
- `diagnosis.json`

## Forbidden

- Claiming root cause certainty without evidence
- Skipping reproduce when commands are available
- Modifying code during analysis
- Reading `.env` / secrets
- Operating on Pi upstream
