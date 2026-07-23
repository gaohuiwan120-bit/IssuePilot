# Phase M3B + M4 MVP Report

## 范围

Skills、模型配置、IssueOrchestrator 闭环、CLI、Mock 测试、Live E2E 门控、文档。  
**未自动 Commit**（等确认）。

## 已交付

- `.pi/skills/{issue-analysis,safe-code-repair,patch-validation-review}`
- `src/session/*`（model-config、llm-adapter、orchestrator、agent-session-factory）
- `src/cli/issuepilot-cli.ts` + `npm run issuepilot`
- `.env.example`；`.gitignore` 已忽略真实 `.env`
- Mock 测试：`test/session-mvp.test.js` 13/13
- Live：`test/e2e-live.test.js`（无 Key 则 skip，不伪造）

## 明确未做 / 限制

- 完整 Pi Agent 自由 tool-call 多轮对话式修码（MVP 以 Orchestrator 强制阶段为主）
- Live DeepSeek 两例需本机 Key
- 不自动 Commit/Push/真实 GitHub PR
- Patch 在受控 E2E 中可用 Golden 约束，避免无界改写
