# Deterministic Diagnosis (M3A)

`diagnose_issue` 基于规则信号产出 `DiagnosisResult`，**不调用 LLM**。

## 输入信号

- IssueSpec 文本（标题、描述、实际/预期行为）
- ReproductionResult（日志、退出码、失败测试）
- `find_related_code` 结果（可疑文件/符号）
- Stack Trace 行（`at ...` / `File "...", line N`）

## 诊断类别

`validation` | `configuration` | `file-path` | `dependency` | `exception-handling` | `type-error` | `null-or-undefined` | `test-failure` | `build-failure` | `unknown`

## 不确定时的行为

- 返回 `rootCauseCandidates`（多候选）
- 降低 `confidence`
- `verificationStatus = unverified`（或多候选接近时 `partially_verified`）
- **不虚构唯一根因**

## 限制

仅模式匹配与加权；无法替代人工/LLM 深度诊断。无复现证据时强制降置信度并记录 `missingEvidence`。
