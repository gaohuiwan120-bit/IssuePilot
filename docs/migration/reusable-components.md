# IssuePilot 可复用组件清单（Phase M0）

> 范围：`agent-projects/mlpilot/`（不含 `node_modules/`、`dist/`）  
> 复用判定：`直接复用` / `调整` / `重构` / `归档` / `删除` / `新增`  
> 原则：未确认用途的文件不直接删除；优先归档。

---

## 图例

| 标记 | 含义 |
|---|---|
| 直接复用 | 接口与语义可原样用于 IssuePilot |
| 调整 | 保留文件/职责，轻量改名或字段扩展 |
| 重构 | 保留模式，接口或核心逻辑需重写 |
| 归档 | 移至 `archive/mlpilot/`（ML 专用） |
| 删除 | 确认无通用价值后删除（M0 不执行） |
| 新增 | IssuePilot 需要但当前不存在 |

预计新路径默认落在同一包内重命名为 `issuepilot`（或保留目录名至 M1 决定）。下文用 `issuepilot/` 表示目标包根。

---

## 1. 核心源码 `src/`

| 文件路径 | 当前职责 | 是否复用 | 迁移方式 | 预计新路径 | 需要修改的接口 | 对应测试 | 风险 |
|---|---|---|---|---|---|---|---|
| `src/index.ts` | 聚合导出 | 调整（M1） | 导出 stages/names | `src/index.ts` | 导出符号 | 间接 | 低 |
| `src/workflow/phases.ts` | 旧阶段名兼容 re-export | 调整 | 薄封装指向 stages | `src/workflow/phases.ts` | deprecated 别名 | `test/state-machine.test.js` | 低 |
| `src/workflow/stages.ts` | IssuePilot `WorkflowStage` + `STAGE_POLICIES`（含 **reproduce 与 diagnose 分阶段**） | 新增（M1） | — | `src/workflow/stages.ts` | 阶段策略字段 | `test/schema.test.js` / state-machine | — |
| `src/workflow/state-machine.ts` | 门禁前进/重试/终态 | 重构（M1 已落地） | 产物门禁 + approve/checkpoint/patch/test/review | `src/workflow/state-machine.ts` | `WorkflowState` 字段 | `test/state-machine.test.js` | 中 |
| `src/schema/types.ts` | Issue Spec 全套（**ReproductionResult 与 DiagnosisResult 并存**） | 重构（M1 已落地） | 旧 ML 类型见 archive | `src/schema/types.ts` | 全部接口 | `test/schema.test.js` | 中 |
| `src/artifacts/names.ts` | Artifact 名与 taskId 校验 | 新增（M1） | — | `src/artifacts/names.ts` | — | artifact tests | — |
| `src/artifacts/store.ts` | `outputs/<task-id>/`、原子写、防穿越 | 调整（M1 已落地） | — | `src/artifacts/store.ts` | 构造改为 `(outputsRoot, taskId)` | `test/state-machine.test.js` artifacts | 中 |
| `src/risk/levels.ts` | `low`/`medium`/`high` | 重构（M1 已落地） | — | `src/risk/levels.ts` | 枚举 | schema tests | 低 |

---

## 2. Extensions

| 文件路径 | 当前职责 | 是否复用 | 迁移方式 | 预计新路径 | 需要修改的接口 | 对应测试 | 风险 |
|---|---|---|---|---|---|---|---|
| `extensions/workflow-controller.ts` | 阶段持久化、`/mlpilot-*` 命令、tree/compact 钩子 | 调整 | 命令前缀 `/issuepilot-*`；新阶段；reproduce 门禁；重复调用检测 | `extensions/workflow-controller.ts` | `NEXT` 表、状态文件路径 `.issuepilot/`、全局 phase 变量名 | **当前无单测** → M2 补 mock | **高**：会话状态不兼容 |
| `extensions/permission-gate.ts` | bash 危险命令拦截（rm/sudo/git push） | 调整 | 扩展规则与风险分级、凭据/.env/docker.sock 等 | `extensions/permission-gate.ts` | `BLOCKED` 列表、确认策略、可选 allowlist | **无** → M2 补 | 中：过严/过松 |
| `extensions/git-checkpoint.ts` | `stash create` + rollback | 调整 | 分支/worktree/脏区检测/保留失败 diff | `extensions/git-checkpoint.ts` | 命令名、checkpoint API、禁止 hard reset 覆盖 | **无** → M2 补 | **高**：数据丢失 |
| `extensions/docker-executor.ts` | `run_in_docker` 工具 | 调整 | 泛化命令、资源限制、收紧挂载与网络 | `extensions/docker-executor.ts` | 镜像 env 名、`docker run` 参数、命令校验 | **无** → M2 补 | **高**：当前挂载 `mlpilot-pi-session` volume，与安全文档冲突 |
| `extensions/run-recorder.ts` | `tool_execution_end` 写 trace | 调整 | 丰富字段；路径改 outputs | `extensions/run-recorder.ts` | trace schema、目录 | **无** → M2 补 | 低 |
| `extensions/ml-tools.ts` | 8 个 ML 领域工具 | 归档（**已移入** `archive/mlpilot/extensions/`） | 不再被 settings 加载 | `archive/mlpilot/extensions/ml-tools.ts` | — | — | 低 |

---

## 3. Skills

| 文件路径 | 当前职责 | 是否复用 | 迁移方式 | 预计新路径 | 需要修改的接口 | 对应测试 | 风险 |
|---|---|---|---|---|---|---|---|
| `skills/pytorch-error-diagnosis/SKILL.md` | PyTorch 诊断流程提示 | 归档 | 移入 archive | `archive/mlpilot/skills/pytorch-error-diagnosis/` | settings 引用移除 | 无 | 低 |
| `skills/training-instability-analysis/SKILL.md` | NaN/梯度提示 | 归档 | 同上 | `archive/mlpilot/skills/training-instability-analysis/` | settings | 无 | 低 |
| `skills/environment-dependency-repair/SKILL.md` | Python/CUDA 依赖 | 归档 | 纪律可吸收到 safe-code-repair | `archive/mlpilot/skills/...` | settings | 无 | 低 |
| `skills/ml-change-validation/SKILL.md` | pytest/smoke 验证 | 归档 | 吸收到 patch-validation-review | `archive/mlpilot/skills/...` | settings | 无 | 低 |
| （不存在）issue-analysis | — | 新增 | M3 创建 | `skills/issue-analysis/SKILL.md` | settings 增加 | 无 / 文档测 | 低 |
| （不存在）safe-code-repair | — | 新增 | M3 创建 | `skills/safe-code-repair/SKILL.md` | settings | 无 | 低 |
| （不存在）patch-validation-review | — | 新增 | M3 创建 | `skills/patch-validation-review/SKILL.md` | settings | 无 | 低 |

---

## 4. 配置与包元数据

| 文件路径 | 当前职责 | 是否复用 | 迁移方式 | 预计新路径 | 需要修改的接口 | 对应测试 | 风险 |
|---|---|---|---|---|---|---|---|
| `package.json` | name=`mlpilot`、scripts、依赖 Pi | 调整 | name→`issuepilot`；保留 build/check/test/eval | `package.json` | `name`、可选 bin、env 前缀 | npm scripts | 中：依赖路径 |
| `package-lock.json` | 锁文件 | 调整 | 随 rename/install 更新 | `package-lock.json` | — | — | 低 |
| `tsconfig.json` | TS 编译配置 | 直接复用 | 通常无需改 | `tsconfig.json` | — | check/build | 低 |
| `.pi/settings.json.example` | 注册 extensions/skills | 重构 | 换 Issue 扩展与 Skills；去 ml-* | `.pi/settings.json.example` | skills/extensions 数组 | 手工验证 | 中 |

---

## 5. 测试与评测

| 文件路径 | 当前职责 | 是否复用 | 迁移方式 | 预计新路径 | 需要修改的接口 | 对应测试 | 风险 |
|---|---|---|---|---|---|---|---|
| `test/state-machine.test.js` | 阶段前进与 APPROVE 门禁 | 调整 | 断言新初始阶段与门禁 | `test/state-machine.test.js` | import 与期望 phase | 自身 | 中：M1 必改否则红 |
| `eval/runner.mjs` | 加载任务 JSON，校验 id/prompt/rubric | 直接复用（框架） | M5 扩展指标与套件 | `eval/runner.mjs` | CLI、校验字段可扩展 | `npm run eval` | 低 |
| `eval/offline/task-01.json` … `task-30.json` | ML 离线任务占位 | 归档 | 整目录归档后换 Issue 任务 | `archive/mlpilot/eval/offline/` → 新 `eval/offline/` | rubric 字段 | eval | 中：数量从 30→20 |
| `eval/e2e/task-01.json` … `task-10.json` | E2E 占位（含 smokeMustPass） | 归档 | 换通用修复任务；workflow 阶段名更新 | `archive/mlpilot/eval/e2e/` → 新 `eval/e2e/` | `workflow`、`rubric` | eval | 中 |
| `eval/fixtures/**` | bootstrap 提及但**不存在** | 新增（M5） | 创建通用软件 Issue fixtures | `eval/fixtures/` | — | e2e | 当前缺口 |

---

## 6. 文档

| 文件路径 | 当前职责 | 是否复用 | 迁移方式 | 预计新路径 | 需要修改的接口 | 对应测试 | 风险 |
|---|---|---|---|---|---|---|---|
| `README.md` | MLPilot 简介 | 重构 | M6 重写为 IssuePilot | `README.md` | — | — | 低 |
| `docs/architecture.md` | ML 架构简述 | 重构 | M6 重写；M0 可保留作历史 | `docs/architecture.md` | — | — | 低 |
| `docs/demo.md` | ML Demo 步骤 | 归档或重写 | M6 换 Issue Demo | `docs/demo.md` / archive | — | — | 低 |
| `docs/upstream-diff.md` | 与上游差异 | 调整 | 更新产品名与能力表 | `docs/upstream-differences.md`（需求名） | — | — | 低 |
| `docs/upstream/architecture.md` | Pi 上游架构理解 | 直接复用 | 保留；IssuePilot 仍适用 | `docs/upstream/architecture.md` | — | — | 低 |
| `docs/upstream/baseline.md` | Phase0 环境基线（编码损坏） | 调整 | 修复编码或保留历史；不阻塞 | 同路径或 archive | — | — | 低（乱码） |
| `docs/upstream/extension-points.md` | 扩展点设计映射（ML） | 调整 | 改写为 Issue 映射或归档后新写 | `docs/architecture.md` 合并 | — | — | 低 |
| `docs/upstream/security-boundary.md` | 安全边界（含 ML 风险） | 调整 | 泛化软件修复风险；强化 Docker 禁止项 | `docs/safety-model.md` | — | — | 中：实现与文档不一致 |
| `docs/upstream/phase0-verify-results.json` | Phase0 验证结果 | 归档 | 历史证据 | `archive/mlpilot/docs/...` | — | — | 低 |
| `docs/upstream/_*.log` | 构建/测试日志 | 归档/删除 | 确认后可删 | archive 或删除 | — | — | 低 |
| `docs/migration/mlpilot-to-issuepilot.md` | 本迁移设计 | 新增（已完成） | 维护至各 Phase | 同路径 | — | — | — |
| `docs/migration/reusable-components.md` | 本清单 | 新增（已完成） | 各 Phase 回写状态 | 同路径 | — | — | — |
| （不存在）`docs/data-contracts.md` | — | 新增 | M1/M6 | `docs/data-contracts.md` | Schema 契约 | — | — |
| （不存在）`docs/evaluation-report.md` | — | 新增 | M5/M6 | `docs/evaluation-report.md` | — | — | 禁止伪造 |
| （不存在）`docs/safety-model.md` | — | 新增 | 自 security-boundary 演化 | `docs/safety-model.md` | — | — | — |

---

## 7. Scripts 与 Phase0 资产

| 文件路径 | 当前职责 | 是否复用 | 迁移方式 | 预计新路径 | 需要修改的接口 | 对应测试 | 风险 |
|---|---|---|---|---|---|---|---|
| `scripts/bootstrap.mjs` | **会覆写** src/extensions 等为 ML 模板 | 归档 | 迁移期禁用；勿对 IssuePilot 运行 | `archive/mlpilot/scripts/bootstrap.mjs` | — | — | **高**：覆盖用户/迁移改动 |
| `scripts/bootstrap-all.mjs` | 更完整的 ML 脚手架生成（含 eval） | 归档 | 同上；可抽取“生成器模式”后新建 issue 版 | `archive/mlpilot/scripts/bootstrap-all.mjs` | — | — | **高** |
| `scripts/phase0-verify.mjs` | Phase0 验证 | 归档 | 历史 | archive | — | — | 低 |
| `scripts/write-upstream-docs.py` | 生成上游文档 | 调整/归档 | 按需 | archive 或保留 | — | — | 低 |
| `scripts/docker-build.ps1` | 构建沙箱镜像 | 调整 | 镜像名 `issuepilot-*`；去 ML 假设 | `scripts/docker-build.ps1` | 镜像 tag | 手工 | 中 |
| `scripts/_setup.js` | 辅助安装 | 调整 | 检查是否仍需要 | 同或 archive | — | — | 低 |
| `phase0-assets/**` | Phase0 Docker/扩展验证资产 | 归档 | README 已标明临时 | `archive/mlpilot/phase0-assets/` | — | — | 低；含 `docker/.env` 需确认无密钥 |

---

## 8. 按迁移动作汇总

### 8.1 可直接复用（或几乎不动）

- `tsconfig.json`
- `eval/runner.mjs`（框架）
- `docs/upstream/architecture.md`（Pi 理解）
- Pi 上游包 `agent-projects/pi-upstream/**`（**不修改**）
- Pi 内置工具链（read/grep/edit/write/bash）

### 8.2 需要调整

- `extensions/workflow-controller.ts`
- `extensions/permission-gate.ts`
- `extensions/git-checkpoint.ts`
- `extensions/docker-executor.ts`
- `extensions/run-recorder.ts`
- `src/artifacts/store.ts`
- `src/index.ts`
- `package.json` / `.pi/settings.json.example`
- `test/state-machine.test.js`
- 若干 docs（architecture / safety / upstream-diff）

### 8.3 需要重构

- `src/workflow/phases.ts` + `state-machine.ts`
- `src/schema/types.ts`
- `src/risk/levels.ts`
- README / demo / 主架构文档

### 8.4 需要归档（不在 M0 执行移动）

- `extensions/ml-tools.ts`
- `skills/*`（四个 ML Skills）
- `eval/offline/*`、`eval/e2e/*`（ML 任务内容）
- `scripts/bootstrap.mjs`、`scripts/bootstrap-all.mjs`
- `phase0-assets/**`（可选保留作回归）
- `docs/upstream` 历史日志与 ML 专用映射段落

### 8.5 建议删除（仅在归档并确认后）

- `docs/upstream/_*.log`（可用 archive 代替删除）
- 确认无密钥后的临时 `.env` 副本
- 空的无效根 `.git`（工作区问题，非 mlpilot 包内；需人工处理）

### 8.6 需要新增

| 模块 | 建议路径 | 阶段 |
|---|---|---|
| Issue Schema 全套 | `src/schema/*.ts` | M1 |
| `WorkflowStage` 契约与阶段元数据 | `src/workflow/stage-policy.ts` | M1 |
| Schema / Artifact 单测 | `test/schema.test.js` 等 | M1 |
| `issue-tools`（8 工具） | `extensions/issue-tools.ts` | M3 |
| 三 Skills | `skills/issue-analysis` 等 | M3 |
| 阶段门禁增强 | workflow-controller | M2 |
| Eval fixtures + 指标 | `eval/fixtures`、runner 扩展 | M5 |
| 文档集 | `docs/data-contracts.md` 等 | M1–M6 |
| 包/产品重命名 | `issuepilot` | M1 |

---

## 9. 通用能力抽取建议（从 ML 代码中可抢救的部分）

| 来源 | 可抽取的通用逻辑 | 落入 |
|---|---|---|
| `inspect_ml_project` | 目录扫描、检测 requirements/tests、列举入口文件名启发式 | `inspect_repository` |
| `run_test_suite` | 子进程执行 + exitCode 汇总模式 | `run_validation`（命令可配置） |
| `generate_validation_report` | 写 artifacts 文件模式 | `generate_pr_summary`（模板字符串，不调 LLM） |
| `run_in_docker` | docker run 封装 | 增强版 docker-executor |
| `permission-gate` | tool_call 拦截模式 | 保留 |
| `ArtifactStore.appendTrace` | JSONL 追加 | 保留 |
| `workflow-controller` 状态文件 + slash 命令 | 会话级 FSM UX | 保留 |

**不可复用（纯 ML）**：tensor/dtype/device 分析、training log NaN、CUDA/torch 环境探测、smoke training、PyTorch fixtures 类别。

---

## 10. 依赖与上游边界

| 路径 | 判定 | 说明 |
|---|---|---|
| `agent-projects/pi-upstream/**` | 直接复用，**禁止改 core** | IssuePilot 仅通过 Extension/Skill/SDK |
| `node_modules/@earendil-works/pi-coding-agent` | 依赖安装结果 | 来自 file: 链接 |
| 根目录空 `.git` | 环境问题 | 导致无法 `git status`/checkpoint 自测；M2 前需在有效 Git 仓库验证 |

---

## 11. M0 结论

1. **底层可迁移性良好**：五大 Extension + ArtifactStore + 状态机模式 + Eval runner 均可作为 IssuePilot 骨架。  
2. **业务层边界清晰**：`ml-tools`、四 Skills、Schema 中 pytorch/tensor 字段、ML eval 类别应归档。  
3. **实现偏骨架**：安全与 Docker 文档严于代码；评测无真实 fixtures；Skills 内容重复——迁移时应**增强而非仅改名**。  
4. **本阶段仅文档**：未移动/删除/重命名正式业务代码；`check`/`build`/`test`/`eval` 保持绿色。
