# Issue Tools (Phase M3A)

IssuePilot 确定性 Issue 业务工具。工具内部**不调用 LLM**，不推进 Workflow Stage，不自动 Commit/Push/创建 PR。

## 已注册工具

| 工具 | 作用 |
|------|------|
| `parse_issue` | Issue 文本 → `IssueSpec` |
| `inspect_repository` | 仓库扫描 → `RepositoryInventory` |
| `find_related_code` | 关键词/路径/符号定位 |
| `diagnose_issue` | 最小规则诊断 → `DiagnosisResult` |
| `reproduce_issue` | Docker 受控复现 → `ReproductionResult` |
| `run_validation` | Docker 测试/构建/Lint → `ValidationResult` |
| `collect_git_diff` | 只读 Git Diff → `PatchManifest` + `patch.diff` |
| `review_patch` | 规则审查 → `ReviewResult` |
| `generate_pr_summary` | 结构化报告 → `pr_summary.md` |

注册入口：`extensions/issue-tools.ts`（见 `.pi/settings.json.example`）。

## 真正实现的能力

- 输入经 TypeBox / 运行时校验；路径归一化并禁止跳出仓库。
- Artifact 写入 `outputs/<task-id>/`；调用写入 `run_trace.jsonl`。
- 命令执行复用 M2B `DockerExecutor` + M2A Permission Gate（风险阻断）。
- Git 仅 `status`/`diff`/`ls-files`，不 Commit/Reset/Clean。
- 复现必须提供 `expectedFailure` 特征，否则返回 `insufficient_evidence`（不把任意失败当成功复现）。

## 基于规则的限制

- `parse_issue` 只抽取标题/列表/常见章节/路径与符号正则；缺失字段进 `missingInformation`，不虚构步骤或验收标准。
- `find_related_code` / `diagnose_issue` / `review_patch` / `generate_pr_summary` 均为确定性启发式，无语义推理。
- `run_validation` 验收标准通过日志关键词启发式匹配，不是自然语言理解。

## 尚未接入 LLM 的部分

- 根因深度推理、RepairPlan 生成、自动改码、正式 Skills、AgentSession 编排。
- 不提供 / 不读取真实模型 API Key。

## 为何工具层不直接调用 LLM

工具层负责可审计、可复现的证据收集与门禁；LLM 属于后续编排层（M3B+）。工具输出应可在无模型环境下用 Fixture/Docker 验证。
