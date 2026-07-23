# AgentSession Workflow (M3B/M4 MVP)

IssuePilot 用 **IssueOrchestrator** 驱动阶段闭环；可选桥接 Pi `createAgentSession` 做交互演示。

## 阶段顺序

```text
UNDERSTAND → INSPECT → REPRODUCE → DIAGNOSE → PLAN
→ APPROVE → CHECKPOINT → PATCH → TEST → REVIEW → REPORT → completed
```

终态：`completed` | `rolled_back` | `failed`

## 职责划分

| 角色 | 职责 |
|------|------|
| Agent / LLM Adapter | 理解、生成 RepairPlan、生成最小 Patch 内容 |
| 确定性工具 | parse/inspect/find/reproduce/diagnose/diff/validate/review/pr_summary |
| Workflow Controller / state-machine | 阶段迁移与 Artifact 门禁 |
| Permission Gate + Docker Executor | 命令风险与沙箱执行 |
| Git Checkpoint | Patch 前快照；失败时按文件 checkout 回滚（不用 reset --hard） |

## 硬约束

- 工具内部**不**自行推进 Stage
- 未 Approval / 未 Checkpoint **不得** Patch
- 默认 Dry-Run / `allowPatch=false` 不改代码
- 不自动 Commit / Push / 真实 PR
- 缺 API Key 时明确报错，不伪造结果
- Mock Provider 用于单元测试与 CI

## 入口

- CLI：`npm run issuepilot -- run ...`（见 `docs/cli-usage.md`）
- 编程：`IssueOrchestrator`（`src/session/issue-orchestrator.ts`）
- Pi Session：`createIssueAgentSession`（需 DeepSeek Key）
