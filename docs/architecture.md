# MLPilot Architecture

## Stack
- **Pi Agent Harness** (pi-upstream 0.80.6) — Agent loop, Session, Extensions
- **MLPilot** — ML diagnosis workflow on top of Pi

## Workflow
DISCOVER -> DIAGNOSE -> PLAN -> APPROVE -> CHECKPOINT -> PATCH -> VALIDATE -> REPORT

## Extensions
| Extension | Phase | Role |
|---|---|---|
| workflow-controller | 4-5 | State machine, /mlpilot-* commands |
| permission-gate | 2 | tool_call intercept |
| git-checkpoint | 2 | stash + rollback |
| docker-executor | 2 | run_in_docker |
| run-recorder | 2 | run_trace.jsonl |
| ml-tools | 3 | 8 domain tools |

## Artifacts (.mlpilot/artifacts/)
task.json, project_inventory.json, diagnosis.json, repair_plan.json, approval.json, patch_manifest.json, validation.json, run_trace.jsonl, final_report.md

## Session Tree
Use Pi /tree + workflow-controller session_before_tree for multi-fix comparison.