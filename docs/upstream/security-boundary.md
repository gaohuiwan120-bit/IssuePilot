# Pi Security Boundary & MLPilot 建议

> **历史文档：** Phase 0 安全边界笔记，**不是**现行安装说明。现行容器与执行策略见 [`docs/container-security.md`](../container-security.md) 与 [`README.md`](../../README.md)。

## 核心结论

**Project Trust ≠ Sandbox。** Pi 以启动用户权限运行，无 OS 级隔离。

| 机制 | 效果 |
|---|---|
| Project Trust | 控制是否加载项目 .pi/settings、extensions、skills |
| AGENTS.md | 始终加载，不受 trust 限制 |
| Extension | 与 Pi 同进程、同权限 |
| bash/read/write | 受 OS 权限约束，无路径 allowlist |

## Extension 权限

- jiti 加载 TS，可 registerTool、拦截 tool_call
- 恶意扩展可读 auth.json、环境变量、任意文件
- MLPilot：仅安装审查过的扩展；permission-gate 默认 block 高危命令

## API Key 风险

- 存储：环境变量、~/.pi/agent/auth.json
- Docker -e 注入会进入容器环境
- 建议：宿主或推理网关持钥；评测用 mock provider

## Docker 挂载策略

| 挂载 | MLPilot |
|---|---|
| 临时 worktree → /workspace | 允许 |
| named volume → 容器 session | 允许 |
| ~/.pi/agent、Home、docker.sock | **禁止** |

## ML 项目特有风险

恶意训练脚本、pickle RCE、依赖投毒、日志注入、大文件 DoS

## MLPilot 安全分层

1. Project Trust（Pi 内置）
2. permission-gate
3. git-checkpoint
4. docker-executor
5. run-recorder
6. 人工 APPROVE

## Phase 0 观察

- Windows UTF-16 文件导致 Dockerfile/脚本解析失败
- Windows symlink EPERM 导致部分测试失败
- GitHub/Docker Hub 网络不稳定
