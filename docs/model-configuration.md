# Model Configuration

## 支持的 Provider

| Provider | 用途 | Key |
|----------|------|-----|
| `mock` | 单元测试 / CI / 默认安全演示 | 不需要 |
| `deepseek` | 真实计划生成（E2E） | `DEEPSEEK_API_KEY` |

不修改 Pi upstream Provider 源码。Key 解析顺序：进程环境变量 → 项目根 `.env`（`loadDotEnv`）。

## 配置方式

1. 复制 `.env.example` → `.env`，填写：

```text
DEEPSEEK_API_KEY=
ISSUEPILOT_PROVIDER=mock
ISSUEPILOT_MODEL=deepseek-chat
```

2. 或系统/终端环境变量 `DEEPSEEK_API_KEY`。
3. Pi 交互：`/login` → DeepSeek（写入 `~/.pi/agent/auth.json`，勿提交）。

## 安全

- `.gitignore` 已忽略 `.env` / `.env.*`（保留 `.env.example`）
- 日志只记录 provider/model；`redactSummary` 遮蔽 key
- 缺少 Key 时抛 `MISSING_API_KEY`，禁止静默伪造
- 真实 Key **不得**写入源码、测试快照、Git

## 测试策略

- 默认 Mock Provider
- 仅 `npm run test:e2e-live` 在 Key+Docker 可用时调用 DeepSeek（2 个 Fixture）
