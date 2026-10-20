# Phase M3A Report — Deterministic Issue Toolchain

> **历史文档：** 阶段性交付报告，**不是**现行安装说明。现行用法见 [`README.md`](../README.md)。

## 范围

实现 8 个 Issue 业务工具 + 最小确定性诊断；Fixture；单元与真实 Docker 工具测试；文档。不接入真实 AgentSession / Skills / 自动改码 / 真实模型。

## 验收对照

1. 8 工具已实现并导出（另含 `diagnose_issue`）
2. Schema 对齐 `src/schema/types.ts`
3. Run Trace / ArtifactStore 写入
4. Docker 工具复用 M2B Executor
5. 不调用真实模型
6. Fixture 六套齐全
7. 单元测试：`test/issue-tools-unit.test.js` 25/25
8. Docker 工具测试：`test/issue-tools-docker.test.js` 9/9（真实容器）
9. 全量 `npm test`：**114/114** 通过，0 跳过
10. `npm run check` / `npm run build` 通过
11. IssuePilot 仓库未修改 Pi upstream 源码（upstream 工作区另有既有本地脏文件，与本阶段无关）

## 明确未做

自动代码修复、正式 Skills、LLM 诊断/计划、GitHub API、自动 Commit/Push/PR、修改 Pi upstream。
