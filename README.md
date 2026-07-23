# IssuePilot：基于 Pi 的 GitHub Issue 自动修复与代码审查 Agent

> 物理目录暂为 `agent-projects/mlpilot/`（迁移稳定后再决定是否重命名）。

## 当前阶段

Phase **M3A**（确定性工具）已打 tag `issuepilot-m3a`。  
Phase **M3B/M4 MVP**：Skills + IssueOrchestrator 闭环 + CLI（本工作区未自动 Commit）。

## Quick Start

```bash
npm install --ignore-scripts
npm run check
npm run build
npm test
```

### 受控演示（Fixture + Mock，不污染原 Fixture）

```bash
# 可选：cp .env.example .env 并填写 DEEPSEEK_API_KEY（仅 live）
cp .pi/settings.json.example .pi/settings.json

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

说明：当前演示使用 **Fixture 工作副本**，不是真实开源仓库成果。

## Workflow

```text
understand → inspect → reproduce → diagnose → plan → approve
→ checkpoint → patch → test → review → report → completed
```

## Docs

- `docs/agent-session-workflow.md`
- `docs/skills.md`
- `docs/model-configuration.md`
- `docs/cli-usage.md`
- `docs/issue-tools.md`
- `docs/mvp-evaluation-report.md`
- `docs/phase-m4-mvp-report.md`

## 与 Pi 上游

不修改 Pi core；通过 Extension / Skill / SDK 扩展。
