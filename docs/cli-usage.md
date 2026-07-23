# CLI Usage

```bash
npm run issuepilot -- run --repo <path> --issue <issue.md> [options]
npm run issuepilot -- status --repo <path> --task <taskId>
npm run issuepilot -- approve --repo <path> --task <taskId> --yes|--no
npm run issuepilot -- artifacts --repo <path> --task <taskId>
```

## run 选项

| 选项 | 说明 |
|------|------|
| `--provider mock\|deepseek` | 默认 mock |
| `--model <id>` | 模型标识 |
| `--dry-run` | 停在 patch 之前 |
| `--allow-patch` | 允许 checkpoint+patch（默认关） |
| `--approve` | 自动批准 RepairPlan |
| `--work-copy <dir>` | 先复制仓库再跑（保护 Fixture） |
| `--golden-fixed <dir>` | 受控 E2E 用 Golden 修复内容 |
| `--repro-cmd` / `--expect-fail` / `--test-cmd` | JSON 命令与期望失败特征 |
| `--image` | Docker 镜像名 |

## 安全默认

- 不 patch、不 commit、不 push、不建真实 PR
- 网络默认关闭（Docker 策略）
- 需显式 `--approve` + `--allow-patch` 才会改代码

## 演示示例（Fixture + Mock）

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

（真实 Docker 复现/验证时去掉 `--skip-docker-check`，并指定 `--image issuepilot-node:local`。）
