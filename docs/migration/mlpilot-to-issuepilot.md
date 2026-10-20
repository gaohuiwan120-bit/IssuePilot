# MLPilot → IssuePilot 迁移设计（Phase M0）

> **历史文档：** 本文是 2026-07 迁移设计记录，**不是**现行安装说明。现行依赖、环境与启动方式见仓库根目录 [`README.md`](../../README.md)。文中若出现本地 `file:../pi-upstream/...`，仅反映当时开发环境；当前通过 npm 使用 `@earendil-works/pi-coding-agent@0.80.6`。

> 状态：M0 审查完成 → **M0.5 基线 + M1 契约迁移进行中/已落地**  
> 审查日期：2026-07-23  
> 基线路径：`agent-projects/mlpilot/`（物理目录名暂保留）  
> 产品名：IssuePilot  
> 上游依赖（历史）：`@earendil-works/pi-coding-agent`（本地 `file:../pi-upstream/packages/coding-agent`，版本 0.80.6）  
> Git 基线说明：见 [`m0.5-git-baseline.md`](./m0.5-git-baseline.md)（上级空 `.git` 未删除；已建等效快照）

---

## 1. 原项目架构（MLPilot）

### 1.1 定位

MLPilot 是基于 Pi Agent Harness 的**机器学习代码诊断与实验自动化 Agent**：解析 PyTorch 项目、诊断 tensor/训练不稳定/环境问题、生成修复计划、受控改码、容器内验证并产出报告。

### 1.2 分层

```text
┌─────────────────────────────────────────────────────────┐
│  Skills（领域流程提示）                                  │
│  pytorch-error-diagnosis / training-instability-…       │
├─────────────────────────────────────────────────────────┤
│  Extensions（Pi 生命周期 / 工具 / 命令）                   │
│  workflow-controller · permission-gate · git-checkpoint │
│  docker-executor · run-recorder · ml-tools              │
├─────────────────────────────────────────────────────────┤
│  Schema / Workflow / Artifacts（src/）                   │
│  phases · state-machine · types · ArtifactStore · risk  │
├─────────────────────────────────────────────────────────┤
│  Eval harness（eval/runner.mjs + offline/e2e tasks）     │
├─────────────────────────────────────────────────────────┤
│  Pi Upstream（不修改 core）                              │
│  AgentSession · Tool Calling · Compaction · Tree …      │
└─────────────────────────────────────────────────────────┘
```

### 1.3 现有工作流状态机

```text
DISCOVER → DIAGNOSE → PLAN → APPROVE → CHECKPOINT → PATCH → VALIDATE → REPORT
```

实现位置：

| 层 | 文件 | 说明 |
|---|---|---|
| 类型与转移表 | `src/workflow/phases.ts` | `WORKFLOW_PHASES` / `PHASE_TRANSITIONS` |
| 运行时状态 | `src/workflow/state-machine.ts` | `createInitialState` / `advance` / `retryFromValidate` |
| Extension 持久化 | `extensions/workflow-controller.ts` | `.mlpilot/workflow-state.json` + `/mlpilot-*` 命令 |

### 1.4 现有产物约定

目录：`.mlpilot/artifacts/`（`ArtifactStore.defaultArtifactDir`）

```text
task.json
project_inventory.json
diagnosis.json
repair_plan.json
approval.json
patch_manifest.json
validation.json
run_trace.jsonl
final_report.md
```

### 1.5 成熟度观察（审查结论）

| 能力 | 状态 | 说明 |
|---|---|---|
| Schema + 状态机 + ArtifactStore | 已实现（轻量） | 可编译、有 2 个单元测试 |
| 6 个 Extensions | 已实现（骨架） | 可用但能力偏薄，含 ML 专用逻辑 |
| 4 个 Skills | 已实现（极简） | 内容几乎相同，仅描述不同 |
| Eval | 框架可运行 | 30 offline + 10 e2e；**无真实 fixtures 目录**；runner 仅做 schema 校验 |
| Docker 安全边界 | 部分 | 文档要求严格，实现仍挂载 named volume 到 session |
| Git 仓库状态 | 不可用 | 工作区根 `.git` 为空目录，非有效 Git 仓库 |
| bootstrap 脚本 | 存在 | `scripts/bootstrap*.mjs` 可重写源码，迁移期需慎用 |

---

## 2. 新项目架构（IssuePilot）

### 2.1 定位

IssuePilot：基于 Pi 的 **GitHub Issue 自动修复与代码审查 Agent**。

闭环（**复现与根因分析分阶段**，勿将 DIAGNOSE 直接映射为 REPRODUCE）：

```text
UNDERSTAND → INSPECT → REPRODUCE → DIAGNOSE → PLAN → APPROVE
→ CHECKPOINT → PATCH → TEST → REVIEW → REPORT
→ COMPLETED | ROLLED_BACK | FAILED
```

### 2.2 目标分层（增量迁移后）

```text
┌─────────────────────────────────────────────────────────┐
│  Skills                                                  │
│  issue-analysis · safe-code-repair · patch-validation…  │
├─────────────────────────────────────────────────────────┤
│  Extensions（保留并增强）                                 │
│  workflow-controller · permission-gate · git-checkpoint │
│  docker-executor · run-recorder · issue-tools（新）      │
├─────────────────────────────────────────────────────────┤
│  Schema / Workflow / Artifacts                           │
│  WorkflowStage · IssueSpec · ReproductionResult · …     │
├─────────────────────────────────────────────────────────┤
│  Eval（框架保留，任务集替换）                              │
│  20 offline Issue 理解/规划 + 10 E2E 修复                 │
├─────────────────────────────────────────────────────────┤
│  Pi Upstream（仍不修改 core）                             │
└─────────────────────────────────────────────────────────┘
```

### 2.3 迁移原则（摘要）

1. **不推倒重写**：保留 Pi 接入、Extension 骨架、状态机模式、ArtifactStore、Eval runner、测试基础设施。
2. **ML 业务下沉**：`ml-tools`、ML Skills、ML Schema 字段、ML Eval 任务 → `archive/mlpilot/`（先归档后删除）。
3. **先契约后工具**：Phase M1 只改名称/Schema/状态机/产物协议；M3 再实现 Issue 工具。
4. **不破坏现有绿测**：每阶段保持 `npm run check/build/test` 通过。

---

## 3. 状态机映射（已按 M0.5 修正）

| MLPilot 阶段 | IssuePilot 阶段 | 映射说明 |
|---|---|---|
| `DISCOVER` | `understand` | 解析 Issue / Bug → `IssueSpec` / `issue_spec.json` |
| （无） | `inspect` | **新增**：仓库盘点 → `RepositoryInventory` |
| （无；原 DIAGNOSE 中“跑起来看”部分） | `reproduce` | **新增独立阶段**：复现 → `ReproductionResult`（**不是**原 DIAGNOSE 的整体替换） |
| `DIAGNOSE` | `diagnose` | **保留诊断语义**：根因分析 → `DiagnosisResult` / `diagnosis.json` |
| `PLAN` | `plan` | 通用 `RepairPlan` |
| `APPROVE` | `approve` | 中高风险需人工确认 |
| `CHECKPOINT` | `checkpoint` | 分支 / worktree / 禁止覆盖脏区 |
| `PATCH` | `patch` | 仅批准范围内改码 |
| `VALIDATE` | `test` | 测试/构建/静态检查 → `ValidationResult` |
| （无） | `review` | Diff 审查 → `ReviewResult` |
| `REPORT` | `report` | `pr_summary.md` 等 |
| （隐式 DONE） | `completed` / `rolled_back` / `failed` | 显式终态 |

```typescript
export type WorkflowStage =
  | "understand" | "inspect" | "reproduce" | "diagnose" | "plan"
  | "approve" | "checkpoint" | "patch" | "test" | "review" | "report"
  | "completed" | "rolled_back" | "failed";
```

### 3.1 阶段策略（M1 已实现于 `src/workflow/stages.ts`）

每阶段明确：允许的前置阶段、必须 Artifact、是否人工确认、是否可重试、最大重试、失败目标状态。

| 阶段 | 前置 | 进入所需 Artifact | 人工确认 | 可重试 | 最大重试 | 失败目标 |
|---|---|---|---|---|---|---|
| understand | （起始） | — | 否 | 是 | 2 | failed |
| inspect | understand | `issue_spec.json` | 否 | 是 | 1 | failed |
| reproduce | inspect | `repository_inventory.json` | 否 | 是 | 2 | failed |
| diagnose | reproduce | `reproduction.json` | 否 | 是 | 2 | failed |
| plan | diagnose | `diagnosis.json` | 否 | 是 | 2 | failed |
| approve | plan | `repair_plan.json` | **是**（中高风险） | 否 | 0 | failed |
| checkpoint | approve | `approval.json` | 否 | 是 | 1 | failed |
| patch | checkpoint | 检查点已创建 | 否 | 是 | 1 | rolled_back |
| test | patch | `patch_manifest.json` + 已产出 patch | 否 | 是 | 3 | rolled_back |
| review | test | `validation.json` + 已实际执行验证 | 否 | 是 | 1 | failed |
| report | review | `review.json` | 否 | 否 | 0 | failed |

### 3.2 硬性门禁

1. 无 `issue_spec.json` → 不得 `inspect`
2. 无 `repository_inventory.json` → 不得 `reproduce`
3. 无 `reproduction.json` → 不得 `diagnose`
4. 无法复现必须记录原因与证据，**禁止伪造成功复现**
5. 无 `diagnosis.json` → 不得 `plan`
6. 中高风险计划未批准 → 不得 `checkpoint`
7. 未创建检查点 → 不得 `patch`
8. 未产生 Patch → 不得 `test`
9. 未实际执行验证 → 不得 `review`
10. Review 不通过 → 不得 `completed`
11. 测试失败且达最大重试 → `rolled_back` 或 `failed`

---

## 4. Schema 映射（已按 M0.5 修正）

**重要：** 不得用 `ReproductionResult` 替换 `DiagnosisResult`。二者并存：

| 类型 | 职责 |
|---|---|
| `ReproductionResult` | 是否复现、命令、退出码、观察行为、日志、失败测试、无法复现原因、置信度 |
| `DiagnosisResult` | 根因摘要/候选、证据、可疑文件与符号、调用链、置信度、验证状态、缺失证据 |

| MLPilot | IssuePilot | 迁移方式 |
|---|---|---|
| `TaskSpec` | `IssueSpec` | **重构** |
| `ProjectInventory`（pytorch） | `RepositoryInventory` | **重构** |
| （无独立复现类型） | `ReproductionResult` | **新增**（复现阶段） |
| `DiagnosisResult`（tensor/NaN…） | `DiagnosisResult`（通用根因） | **重构字段**，**保留类型名与诊断阶段** |
| `RepairPlan` | `RepairPlan` | **调整**（`riskLevel`: low/medium/high） |
| `ApprovalDecision` | `ApprovalDecision` | **扩展** |
| `PatchManifest` | `PatchManifest` | **增强** |
| `ValidationResult` | `ValidationResult` | **泛化**（去 smoke） |
| （无） | `ReviewResult` | **新增** |
| `WorkflowSnapshot` | `WorkflowSnapshot` | **调整**（`stage` 字段） |
| 旧 Risk 五级 | `low` \| `medium` \| `high` | **重构** |
| — | `VerificationStatus` | verified / partially_verified / unverified / conflicting |

旧 ML Schema 已归档：`archive/mlpilot/schemas/*.mlpilot.ts`。

---

## 5. Tool 映射

### 5.1 保留 Pi 内置（不重复实现）

`read` / `grep` / `edit` / `write` / `bash`

### 5.2 ML 工具 → Issue 工具

| 现有（`extensions/ml-tools.ts`） | 处置 | IssuePilot 目标工具 |
|---|---|---|
| `inspect_ml_project` | 归档；通用扫描逻辑可抽取 | `inspect_repository` |
| `parse_training_log` | 归档 | （无直接对应；日志解析若需可进 reproduce 内部） |
| `inspect_python_environment` | 归档；可泛化为环境探测片段 | `inspect_repository` / `reproduce_issue` 的一部分 |
| `analyze_tensor_failure` | 归档 | — |
| `analyze_training_instability` | 归档 | — |
| `run_test_suite`（pytest 硬编码） | 重构为多命令 | `run_validation` |
| `run_training_smoke_test` | 归档 | `reproduce_issue`（最小复现） |
| `generate_validation_report` | 调整为确定性报告 | `generate_pr_summary`（**禁止再调 LLM**） |
| `run_in_docker`（docker-executor） | **保留并泛化** | 仍可由 reproduce/validation 调用 |
| （无） | 新增 | `parse_issue` |
| （无） | 新增 | `find_related_code` |
| （无） | 新增 | `collect_git_diff` |
| （无） | 新增 | `review_patch` |

建议：M3 将 `ml-tools.ts` 整文件归档，新建 `extensions/issue-tools.ts`（或按工具拆分），避免在同一文件内混装 ML/Issue。

---

## 6. Skill 映射

| MLPilot Skill | 处置 | IssuePilot Skill |
|---|---|---|
| `skills/pytorch-error-diagnosis/` | 归档 | — |
| `skills/training-instability-analysis/` | 归档 | — |
| `skills/environment-dependency-repair/` | 归档（部分“依赖修复纪律”可吸收到 safe-code-repair） | — |
| `skills/ml-change-validation/` | 归档（验证纪律可吸收） | `patch-validation-review` |
| （无） | 新增 | `issue-analysis` |
| （无） | 新增 | `safe-code-repair` |
| （无） | 新增 | `patch-validation-review` |

目标目录：

```text
.pi/skills/   或  skills/
├── issue-analysis/SKILL.md
├── safe-code-repair/SKILL.md
└── patch-validation-review/SKILL.md
```

（现有项目 Skills 在 `skills/`，经 `.pi/settings.json.example` 引用；M1 可统一命名空间为 IssuePilot，不必强行搬到 `.pi/skills` 除非与 Pi 约定一致。）

---

## 7. Artifact 映射

| MLPilot（`.mlpilot/artifacts/`） | IssuePilot（`outputs/<task-id>/`） |
|---|---|
| `task.json` | `issue_spec.json` |
| `project_inventory.json` | `repository_inventory.json` |
| （无独立） | `reproduction.json`（**新增**） |
| `diagnosis.json` | `diagnosis.json`（**保留**，语义改为通用根因） |
| `repair_plan.json` | `repair_plan.json` |
| `approval.json` | `approval.json` |
| `patch_manifest.json` | `patch_manifest.json` |
| （常缺失） | `patch.diff` |
| `validation.json` | `validation.json` |
| （无） | `review.json` |
| `run_trace.jsonl` | `run_trace.jsonl` |
| `final_report.md` | `pr_summary.md` |

`ArtifactStore`（`src/artifacts/store.ts`）需在 M1：

- 更新 `ARTIFACT_NAMES`
- 默认根目录从 `.mlpilot/artifacts` → `outputs/<task-id>`
- 保留 `writeJson` / `appendTrace` 模式

---

## 8. Evaluation 映射

| 维度 | MLPilot | IssuePilot |
|---|---|---|
| Runner | `eval/runner.mjs`（校验 id/prompt/rubric） | **保留框架**，扩展指标收集（M5） |
| Offline | 30 任务，10 类 ML 缺陷（shape/dtype/device/nan/grad/import/cuda_oom/dataloader/checkpoint/optimizer） | **替换**为 20 个 Issue 理解与规划任务 |
| E2E | 10 任务，占位 prompt，rubric 含 smokeMustPass | **替换**为 10 个端到端修复任务（去掉 smoke，改为 test/build/lint） |
| Fixtures | bootstrap 提及 `eval/fixtures/*`，**目录不存在** | M5 新建通用软件 Issue fixtures |
| 指标 | 无真实度量实现 | `issue_parse_accuracy`、`reproduction_success_rate`、`repair_success_rate` 等（见需求第十一节）；**禁止伪造结果** |

建议分类（M5）：

| 类型 | 数量 |
|---|---|
| 参数和边界校验 | 4 |
| API 错误处理 | 3 |
| 文件和配置问题 | 3 |
| 数据处理逻辑错误 | 3 |
| 异步与状态错误 | 2 |
| 测试和构建失败 | 3 |
| 安全与权限问题 | 2 |
| **合计（示例池）** | **20**（offline 可从中取 20；e2e 另选 10） |

---

## 9. Extensions 迁移要点

| Extension | 迁移 | 关键增强 |
|---|---|---|
| `workflow-controller` | 调整 | 新阶段名；阻止未 reproduce 进 patch；重复工具调用检测；最大工具次数；验收门禁 |
| `permission-gate` | 增强 | 扩展 BLOCKED 模式：`git reset --hard`、`git clean`、`.env`、docker.sock、sudo、依赖安装、网络等；风险三级 |
| `git-checkpoint` | 增强 | 初始 commit、修复分支、可选 worktree、保留失败 diff、禁止覆盖用户未提交修改 |
| `docker-executor` | 泛化 | 支持 npm/pytest/ruff/go test 等；限制 CPU/内存/超时/网络；命令白名单；**移除不当 Home/session 挂载** |
| `run-recorder` | 调整 | 记录 Issue、阶段、参数摘要、退出码、diff 统计、批准、回滚、token、终态 |
| `ml-tools` | 归档 | 由 issue-tools 替代 |

---

## 10. 分阶段实施计划

| Phase | 范围 | 禁止项 | 退出标准 |
|---|---|---|---|
| **M0（本阶段）** | 审查 + 迁移文档 | 不改业务代码 | 两份 docs 齐备；check/build/test 绿 |
| **M1** | 重命名、WorkflowStage、新 Schema、Artifacts 协议、Schema 单测 | 不实现新工具；不改 eval 数据集内容策略上可先兼容旧测试 | check/build/test 绿；旧 ML 类型可临时 `@deprecated` 或双轨 |
| **M2** | 五大通用 Extension 调整 | 不引入完整 Issue 工具集 | 安全门禁单测/mock；Docker 边界符合文档 |
| **M3** | Issue 工具 + Skills + 单测/Mock | 不强制全链路 E2E | 工具契约测试通过 |
| **M4** | UNDERSTAND→REPORT 闭环 | 不伪造评测分数 | Demo 一条真实 Issue 链路可跑通 |
| **M5** | Eval 任务替换与指标 | 不删 runner；不弱化断言 | 20+10 任务可加载；指标可计算 |
| **M6** | README/演示/简历量化 | — | 文档齐全 |

归档建议时机：M1 引入新 Schema 后，将 ML 专用文件移至 `archive/mlpilot/`（**移动而非直接删除**）。

---

## 11. 风险与回滚方式

### 11.1 风险清单

| ID | 风险 | 等级 | 缓解 |
|---|---|---|---|
| R1 | 状态机改名导致 Extension / 测试 / eval workflow 字段断裂 | 高 | M1 提供别名映射表；测试双写一段时间 |
| R2 | `permission-gate` 过严阻断合法修复流程 | 中 | 风险分级 + 可配置允许列表 + 人工确认 |
| R3 | Docker 挂载/网络改动导致复现失败 | 中 | 保留 plain docker 基线镜像；命令白名单渐进收紧 |
| R4 | `git-checkpoint` 误操作用户脏工作区 | 高 | 检测 dirty tree；有未提交改动则中止并提示 |
| R5 | bootstrap 脚本覆盖手改源码 | 高 | 迁移期禁用或改写为 IssuePilot 生成器；文档标明危险 |
| R6 | 无效 Git（空 `.git`）导致检查点功能无法验证 | 中 | IssuePilot 目标仓库必须是有效 Git；本 monorepo 根目录需单独处理 |
| R7 | Eval 仅有 schema 校验，迁移后“全绿”不等于能力就绪 | 中 | M5 引入真实 fixtures 与指标；文档标明当前局限 |
| R8 | 误改 Pi upstream | 高 | 依赖保持 `file:`；禁止改 `pi-upstream/packages/**` |
| R9 | 一次改太多导致无法定位回归 | 高 | 严格按 M0–M6；每阶段可回退文档+代码快照 |

### 11.2 回滚策略

1. **文档回滚**：本目录文档为增量新增，删除 `docs/migration/` 即可撤销 M0 交付物。
2. **代码回滚（M1+）**：每阶段开始前打 tag / 复制 `archive/snapshots/pre-M{n}/`；优先 `git`（需先修复空 `.git` 或在有效仓库中开发）。
3. **双轨兼容**：M1 可暂时保留旧阶段名常量 `LEGACY_WORKFLOW_PHASES`，Extension 读取时做映射。
4. **归档恢复**：`archive/mlpilot/**` 整目录可拷回原路径。
5. **禁止**：用删测试、skip、弱断言来“通过”迁移。

---

## 12. Phase M0 / M0.5 / M1 环境记录

| 项 | 结果 |
|---|---|
| `npm run check` | 通过（M1 后） |
| `npm run build` | 通过 |
| `npm test` | 通过（19 tests） |
| `npm run eval` | 通过（0 任务占位；ML 任务已归档） |
| Git 未提交变更 | 无有效仓库；见 `m0.5-git-baseline.md` |
| 等效快照 | `archive/snapshots/mlpilot-baseline-m0.5/` |
| ML 归档 | `archive/mlpilot/` |
| 正式业务代码（M0） | 未改 |
| 正式契约代码（M1） | 已改：名称 / Stage / Schema / Artifacts；**未**实现 Issue 业务工具与正式 Skills |

---

## 13. 参考路径

- 可复用组件逐文件清单：[`reusable-components.md`](./reusable-components.md)
- 现有架构：[`../architecture.md`](../architecture.md)
- 上游差异：[`../upstream-diff.md`](../upstream-diff.md)
- 安全边界：[`../upstream/security-boundary.md`](../upstream/security-boundary.md)
