# IssuePilot

IssuePilot 是面向软件工程任务的 AI Coding Agent。它帮助开发者理解问题、分析代码，并在受控流程中推进 Issue 修复。

当前物理目录仍为 `agent-projects/mlpilot/`；产品名称统一为 IssuePilot。

## 能力边界

IssuePilot 提供两条独立入口，不要混为一谈：

| 入口 | 命令 | 能力 |
|------|------|------|
| 自由对话 | `npm run chat` | 基于 Pi Agent SDK（`@earendil-works/pi-coding-agent`）的多轮对话，接入 DeepSeek；支持独立会话、历史恢复与删除 |
| Issue 修复流水线 | `npm run issuepilot -- run …` | 由 IssuePilot 自研的 `IssueOrchestrator` 驱动：理解 Issue、检查仓库、复现、诊断、生成计划、审批、Checkpoint、补丁、测试、审查与报告 |

自由对话可以讨论代码并调用已注册的工具，但**不等于**已经自动完成完整的 Issue 修复闭环。完整修复请走 CLI 流水线，且默认不改代码、不 commit、不 push、不创建真实 PR。

### 谁实现了什么

- **IssuePilot 自研**：聊天页面与会话管理、`IssueOrchestrator`、确定性 Issue 工具、工作流状态机、权限审批、Docker 执行策略、Git Checkpoint、Artifact / Trace、`.pi` 下的 Skills 与 Extensions。
- **第三方 SDK（非本仓库自研）**：通过 npm 依赖 `@earendil-works/pi-coding-agent@0.80.6`（Pi Coding Agent，作者 Mario Zechner，MIT License）获得 Agent 循环与 SDK API（`createAgentSession`、`SessionManager`、`AuthStorage`、`ModelRegistry`、`DefaultResourceLoader`、`ExtensionAPI` 类型等）以及 `.pi/` 配置约定。本仓库不修改 Pi core，也不要求同级检出 `pi-upstream`。

## 环境要求

- **Node.js ≥ 22.19.0**（与 `@earendil-works/pi-coding-agent` 的 `engines` 一致）
- npm（用于安装公开依赖与锁文件复现）

## 安装与配置

```bash
cd agent-projects/mlpilot   # 或克隆后的本仓库根目录
npm install                 # 或 npm ci（推荐在 CI / 干净环境）
cp .env.example .env
# 在 .env 中填写 DEEPSEEK_API_KEY（自由对话与 live 模型需要）
cp .pi/settings.json.example .pi/settings.json
npm run build
```

依赖由 `package.json` / `package-lock.json` 从 npm registry 解析，无需额外下载同级 `pi-upstream` 仓库。

## 启动自由对话

```bash
npm run chat
```

浏览器打开：http://127.0.0.1:8787

会话数据保存在本地 `.issuepilot/chat-sessions/`（已在 `.gitignore` 中忽略）。未配置 `DEEPSEEK_API_KEY` 时服务仍可启动，但创建会话会返回明确错误，不会伪造模型回复。

## Issue 修复（Fixture + Mock 演示）

```bash
npm run issuepilot -- run \
  --repo fixtures/issues/node-validation-bug \
  --issue fixtures/issues/node-validation-bug/ISSUE.md \
  --work-copy fixtures/issues/.work/demo-node \
  --provider mock --approve --allow-patch \
  --golden-fixed fixtures/issues/node-validation-bug/golden/fixed \
  --repro-cmd "[[\"node\",\"test/validate.test.js\"]]" \
  --expect-fail "{\"exitCode\":1,\"stderrPattern\":\"FAIL validateUser\"}" \
  --test-cmd "[[\"node\",\"test/validate.test.js\"]]"
```

该演示使用 Fixture 工作副本，不是真实开源仓库上的自动修复结果。更多选项见 `docs/cli-usage.md`。

## Issue 修复工作流

```text
understand → inspect → reproduce → diagnose → plan → approve
→ checkpoint → patch → test → review → report → completed
```

## Issue CLI 快速入口

```bash
npm run issuepilot -- --help
npm run issuepilot -- run --help
```

完整参数与 Fixture 演示见上文「Issue 修复」与 `docs/cli-usage.md`。

## 常用脚本

```bash
npm run check          # TypeScript 类型检查
npm run build          # 编译到 dist/
npm run chat           # 启动对话界面
npm run issuepilot     # Issue 修复 CLI
npm run test:unit      # 单元测试
```

## 第三方许可摘要

- `@earendil-works/pi-coding-agent`（及传递依赖 `@earendil-works/pi-ai`、`pi-agent-core`、`pi-tui`）：**MIT**，版权归属作者 **Mario Zechner** / Earendil Works（见 npm 包元数据与 [pi 仓库](https://github.com/earendil-works/pi)）。IssuePilot 仅通过公开 npm 包消费该 SDK，不将其表述为自研代码。

## 文档

- `docs/cli-usage.md` — CLI 用法
- `docs/model-configuration.md` — 模型与 API Key
- `docs/agent-session-workflow.md` — Orchestrator 工作流
- `docs/architecture.md` — 架构概览
- `docs/demo.md` — 快速演示
- `docs/issue-tools.md` — Issue 工具
- `docs/skills.md` — Skills

历史材料（非现行安装说明；安装与启动以本文为准）：

- `docs/migration/`、`docs/phase-*-report.md`、`docs/upstream/`、`docs/mvp-evaluation-report.md` — 迁移与阶段开发记录
- `archive/mlpilot/` — 已归档的旧 MLPilot 领域模块（不参与构建与运行；见该目录 README）
