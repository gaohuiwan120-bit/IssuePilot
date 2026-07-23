# Issue Fixtures (M3A)

路径：`fixtures/issues/`

| Fixture | 说明 |
|---------|------|
| `node-validation-bug` | Node 校验逻辑缺陷 |
| `node-config-bug` | 缺失配置键 |
| `python-path-bug` | 路径拼接错误 |
| `python-exception-bug` | 未处理 ValueError |
| `mixed-build-failure` | Node+Python 混合，构建/测试失败 |
| `safe-clean-project` | 健康对照项目 |

每个 Fixture 含：`ISSUE.md`、原始失败代码、最小测试/复现脚本、`reproduce.json`、`golden/`（IssueSpec 片段、可选 fixed 代码）、独立 git 基线。

## 安全

不含恶意代码、真实凭据或外部网络依赖。Python 复现使用纯 `python` 脚本（镜像无 pytest/无 pip 安装）。

## 测试类型区分

- **Fixture / Mock 单元测试**：`test/issue-tools-unit.test.js`（Mock Docker CLI）
- **真实 Docker 工具测试**：`test/issue-tools-docker.test.js`（需 `issuepilot-node:local` / `issuepilot-python:local`）

Golden 仅用于对照与“修复后验证模拟”，**不会**被工具当作输出直接返回。
