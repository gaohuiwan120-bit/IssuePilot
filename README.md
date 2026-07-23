# IssuePilot：基于 Pi 的 GitHub Issue 自动修复与代码审查 Agent

> 物理目录暂为 `agent-projects/mlpilot/`（迁移稳定后再决定是否重命名）。  
> 产品名、命令前缀与产物协议已迁移为 IssuePilot。

## 当前阶段

Phase **M0.5 / M1**：名称、WorkflowStage、Schema、Artifact 协议。  
尚未实现正式 Issue 业务工具与 Skills（见后续 M2–M4）。

## Quick Start

```bash
npm install --ignore-scripts
npm run check
npm run build
npm test
```

## Workflow

```text
understand → inspect → reproduce → diagnose → plan → approve
→ checkpoint → patch → test → review → report → completed
```

终态：`completed` | `rolled_back` | `failed`

## Artifacts

```text
outputs/<task-id>/
├── issue_spec.json
├── repository_inventory.json
├── reproduction.json
├── diagnosis.json
├── repair_plan.json
├── approval.json
├── patch_manifest.json
├── patch.diff
├── validation.json
├── review.json
├── run_trace.jsonl
└── pr_summary.md
```

运行状态目录：`.issuepilot/`

## Commands（Extension）

- `/issuepilot-advance`
- `/issuepilot-approve`
- `/issuepilot-checkpoint`
- `/issuepilot-rollback`
- `/issuepilot-retry`

## Docs

- `docs/migration/mlpilot-to-issuepilot.md`
- `docs/migration/reusable-components.md`
- `docs/migration/m0.5-git-baseline.md`
- `archive/mlpilot/` — 已归档的 ML 专用模块

## 与 Pi 上游

不修改 Pi core；通过 Extension / Skill / SDK 扩展。依赖包名仍为 `@earendil-works/pi-coding-agent`。
