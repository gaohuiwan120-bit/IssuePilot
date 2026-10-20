# Phase M2B Report — Docker Security Executor (validated)

> **历史文档：** 阶段性验证报告（2026-07），**不是**现行安装说明。现行用法见 [`README.md`](../README.md)。

Date: 2026-07-23  
Branch: `feature/issuepilot-runtime`  
Base: `issuepilot-m2a` (`3d29c1d`)

## Environment (validated)

| Check | Result |
|---|---|
| Docker Client | 29.6.1 windows/amd64 |
| Docker Server | Desktop 4.81.0 / Engine 29.6.1 linux/amd64 |
| Compose | available |
| Hub pull | blocked on this network; used local official base tags |
| Node image | `issuepilot-node:local` from `node:24-bookworm-slim` |
| Python image | `issuepilot-python:local` from `python:3.12-slim-bookworm` |
| Default user | runtime `--user 1000:1000` (non-root) |

## Integration

`npm run test:docker`: **14/14 passed, 0 skipped**

Including success/fail fixtures, timeout, large output artifacts, read-only mount,
network none, non-root uid, resource limits, cleanup, run trace.

## Fix during validation

Read-only repo mount could not create tmpfs mountpoint under `/workspace/.issuepilot-tmp`.
Writable scratch moved to `/tmp` tmpfs only (security defaults unchanged).

## Cleanup

No `ip-*` IssuePilot containers remained after tests. Pre-existing `deer-flow-*`
containers were left untouched. No `docker * prune` used.
