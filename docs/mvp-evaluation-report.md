# MVP Evaluation Report (2 Fixture cases)

> 本报告仅覆盖受控 Fixture 闭环，**不是**大规模 Benchmark，不得外推通用修复率。

## 环境

| 项 | 值 |
|----|-----|
| 分支 | `feature/issuepilot-runtime` |
| 基线 Tag | `issuepilot-m3a` |
| Provider（自动化） | `mock` |
| Provider（Live） | `deepseek` + `DEEPSEEK_API_KEY`（`.env`） |
| Docker | `issuepilot-node:local` / `issuepilot-python:local` |

## Case A：Node `node-validation-bug`（Live DeepSeek）

| 指标 | 结果 |
|------|------|
| 任务完成 | **是**（`completed`） |
| RepairPlan Schema | 通过 |
| 工具调用 | 阶段工具链成功 |
| 原始失败复现 | 是 |
| 修复后测试 | 是（Docker） |
| 越权修改 | 否（工作副本；原 Fixture 未污染） |
| 任务耗时 | ~56.5s |
| Token | prompt 497 + completion 278 = **775** |
| 估算成本 | ~**$0.00015**（近似，非账单） |

## Case B：Python `python-path-bug`（Live DeepSeek）

| 指标 | 结果 |
|------|------|
| 任务完成 | **是**（`completed`） |
| RepairPlan Schema | 通过 |
| 工具调用 | 阶段工具链成功 |
| 原始失败复现 | 是 |
| 修复后测试 | 是（Docker） |
| 越权修改 | 否 |
| 任务耗时 | ~50.9s |
| Token | prompt 470 + completion 248 = **718** |
| 估算成本 | ~**$0.00014** |

## 合计（两例 Live）

| 项 | 值 |
|----|-----|
| 通过 | 2/2 |
| Token | ~1493 |
| 估算成本 | ~$0.00028 |
| 总墙钟 | ~130s（含两例串行） |

## 结论边界

- 证明：在 Fixture + Docker + DeepSeek 下，MVP 闭环可跑通  
- 不证明：任意开源仓库修复率或大规模成本分布  
- Patch 范围在 Live 中仍可用 Golden 约束，避免无界改写
