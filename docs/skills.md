# Skills (M3B/M4 MVP)

路径：`.pi/skills/`

| Skill | 作用 |
|-------|------|
| `issue-analysis` | parse → inspect → find → reproduce → diagnose |
| `safe-code-repair` | RepairPlan → Approval → Checkpoint → 最小 Patch |
| `patch-validation-review` | diff → validation → review → pr_summary / 回滚 |

每个 Skill 含 frontmatter（name/description/triggers）、必做顺序、禁止行为与输出要求。

启用：复制 `.pi/settings.json.example` → `.pi/settings.json`（已含 skills 路径）。

限制：当前 MVP 主闭环由 IssueOrchestrator 强制执行工具顺序；Skills 主要约束 Pi 交互 Agent 行为，不是单独可执行程序。
