# MLPilot Extension Points（Phase 0 设计映射）

未来 MLPilot 各模块应采用的 Pi 扩展机制。**Phase 0 仅设计，不实现业务。**

## 实现方式

| 方式 | 适用场景 |
|---|---|
| SDK | createAgentSession、AgentSession、SessionManager 编排 |
| Extension | 生命周期 hook、tool_call 拦截、slash 命令 |
| Skill | 领域诊断流程（SKILL.md 渐进式加载） |
| Custom Tool | 结构化 ML 检查（registerTool / defineTool） |
| Pi Package | npm/git 打包 extensions + skills |
| 独立 Python | 重计算/ML 解析，经 bash 或 Docker 调用 |

## 未来 Extensions

| 模块 | 方式 | 说明 |
|---|---|---|
| workflow-controller | Extension + SDK | DISCOVER→REPORT 状态机 |
| permission-gate | Extension | tool_call 拦截高危 bash |
| git-checkpoint | Extension | PATCH 前 commit，失败回滚 |
| docker-executor | Extension + CLI | 测试/冒烟训练进容器 |
| run-recorder | Extension | 写 run_trace.jsonl |

## 未来 Skills

- pytorch-error-diagnosis
- training-instability-analysis
- environment-dependency-repair
- ml-change-validation

## Domain Tools

| 工具 | 方式 |
|---|---|
| inspect_ml_project, parse_training_log | Custom Tool |
| inspect_python_environment, analyze_tensor_failure | Custom Tool + Python |
| run_test_suite, run_training_smoke_test | Custom Tool + Docker |
| generate_validation_report | Custom Tool / Extension |

## Schema / Artifacts

- Schema：独立 mlpilot TypeScript 包
- Artifacts：task.json, diagnosis.json, repair_plan.json, patch.diff, validation.json, run_trace.jsonl, final_report.md
- 写入：Extension/SDK 写 .mlpilot/artifacts/；Session 用 appendCustomEntry 关联

## 避免修改 Pi Core

优先 Extension / Skill / SDK / Pi Package。仅在新 lifecycle hook 等极少数场景才考虑改 core。

## Docker 三方案

| 方案 | MLPilot 阶段 |
|---|---|
| Plain Docker（整进程进容器） | Phase 2 基线 |
| Host Pi + Tool Routing | Phase 2-3 |
| Git Worktree + Docker Executor | Phase 4-5 多方案比较 |

## 可复用 Pi 官方示例

permission-gate.ts, git-checkpoint.ts, hello.ts, dynamic-tools.ts, custom-compaction.ts, sandbox/, gondolin/
