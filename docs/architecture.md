# IssuePilot Architecture

## Stack

- **IssuePilot（本仓库）** — 自由对话 UI / 会话管理、Issue 修复 Orchestrator、确定性工具、工作流状态机、审批、Docker 策略、Git Checkpoint、Artifact / Trace、Extensions 与 Skills。
- **Pi Coding Agent SDK**（公开 npm：`@earendil-works/pi-coding-agent@0.80.6`，MIT，作者 Mario Zechner）— Agent 循环、`createAgentSession`、`SessionManager`、`AuthStorage`、`ModelRegistry`、`DefaultResourceLoader`、`ExtensionAPI`（类型）、`.pi/` 配置约定。本仓库不修改 Pi core，安装时不依赖同级 `pi-upstream` 目录。
- **运行时**：Node.js ≥ 22.19.0。

## 两条入口

```text
npm run chat
  → src/chat/server.ts
  → createIssueAgentSession (Pi SessionManager + DeepSeek)
  → 会话持久化：.issuepilot/chat-sessions/

npm run issuepilot -- run …
  → src/cli/issuepilot-cli.ts
  → IssueOrchestrator
  → tools / security / docker / git / workflow / artifacts / trace
```

## Issue 修复工作流

```text
understand → inspect → reproduce → diagnose → plan → approve
→ checkpoint → patch → test → review → report → completed
```

终态还包括 `rolled_back`、`failed`。阶段定义见 `src/workflow/stages.ts`，由 `IssueOrchestrator` 与状态机推进。

## Extensions（`.pi/settings.json` 注册）

| Extension | 职责 |
|-----------|------|
| `workflow-controller` | 阶段状态、`/issuepilot-advance` 等命令 |
| `permission-gate` | 工具调用风险拦截 |
| `git-checkpoint` | `/issuepilot-checkpoint`、回滚计划 |
| `docker-executor` | 沙箱内执行命令 |
| `run-recorder` | `run_trace.jsonl` |
| `issue-tools` | 确定性 Issue 工具（parse / inspect / diagnose 等） |

旧文档中的 `ml-tools` 与 `/mlpilot-*` 已废弃，不再加载。

## Skills（`.pi/skills/`）

- `issue-analysis`
- `safe-code-repair`
- `patch-validation-review`

## Artifacts

Issue 修复产物写入目标仓库的 `outputs/<task-id>/`（如 `issue_spec.json`、`repair_plan.json`、`review.json`、`run_trace.jsonl` 等）。聊天会话元数据与消息在 `.issuepilot/chat-sessions/`，与 Issue 流水线分离。

## 安全默认

- CLI 默认不 patch；需 `--approve` + `--allow-patch`
- Docker 网络默认关闭，策略见 `config/docker-policy.json`
- 缺少 `DEEPSEEK_API_KEY` 时明确报错，不伪造模型结果
