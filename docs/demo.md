# IssuePilot Demo

物理目录：`agent-projects/mlpilot/`。

## 1. 安装与配置

要求：Node.js ≥ 22.19.0。依赖通过 npm 安装 `@earendil-works/pi-coding-agent@0.80.6`，无需同级 `pi-upstream`。

```bash
cd agent-projects/mlpilot   # 或本仓库根目录
npm install                 # 或 npm ci
npm run build
cp .env.example .env
# 填写 DEEPSEEK_API_KEY（自由对话与 DeepSeek live 需要）
cp .pi/settings.json.example .pi/settings.json
```

## 2. 自由对话

```bash
npm run chat
```

打开 http://127.0.0.1:8787 。可新建会话、切换历史、删除会话；刷新或重启服务后历史可恢复。

说明：对话使用 Pi Agent SDK，并接入 DeepSeek。这是自由讨论入口，不是「一键自动修完整个 Issue」的保证。

## 3. Issue 修复 CLI（Fixture + Mock）

```bash
npm run issuepilot -- run \
  --repo fixtures/issues/node-validation-bug \
  --issue fixtures/issues/node-validation-bug/ISSUE.md \
  --work-copy fixtures/issues/.work/demo-node \
  --provider mock \
  --approve --allow-patch \
  --golden-fixed fixtures/issues/node-validation-bug/golden/fixed \
  --repro-cmd "[[\"node\",\"test/validate.test.js\"]]" \
  --expect-fail "{\"exitCode\":1,\"stderrPattern\":\"FAIL validateUser\"}" \
  --test-cmd "[[\"node\",\"test/validate.test.js\"]]" \
  --skip-docker-check
```

默认安全策略：不 patch、不 commit、不 push、不建真实 PR；需显式 `--approve` 与 `--allow-patch` 才会改代码。详见 `docs/cli-usage.md`。

## 4. Pi 交互中的 IssuePilot 命令（可选）

若通过 Pi coding-agent 加载本项目的 `.pi/settings.json`，可使用扩展命令（不是旧的 `/mlpilot-*`）：

- `/issuepilot-advance`
- `/issuepilot-approve`
- `/issuepilot-checkpoint`
- `/issuepilot-rollback-plan`
- `/issuepilot-retry`
- `/issuepilot-interrupt`

Skills（在 `.pi/skills/`）：

- `/skill:issue-analysis`
- `/skill:safe-code-repair`
- `/skill:patch-validation-review`
