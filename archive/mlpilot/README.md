# Archived MLPilot domain modules

These files were moved out of the live IssuePilot tree during Phase M0.5 / M1.

They are **not** compiled by TypeScript (`tsconfig` only includes `src/`), **not** loaded by `.pi/settings.json.example`, and **not** discovered as live Skills.

## Layout

| Path | Original role | Why archived |
|---|---|---|
| `extensions/ml-tools.ts` | PyTorch / training log / tensor / smoke tools | ML-specific domain tools |
| `skills/*` | ML diagnosis and validation skills | ML-specific procedural prompts |
| `schemas/*.mlpilot.ts` | Pre-migration Schema / phases / risk enums | Historical contract snapshot |
| `evaluation/offline|e2e` | 30+10 ML defect eval tasks | Replaced in M5 by Issue tasks |
| `scripts/bootstrap*.mjs` | Generators that overwrite live source | Unsafe during migration |

## Restore

Copy a path back into the live tree only if you intentionally revive MLPilot behavior. Prefer restoring from `archive/snapshots/mlpilot-baseline-m0.5/` for a full pre-migration tree.
