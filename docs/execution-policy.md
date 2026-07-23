# Execution Policy

Source of truth: `config/docker-policy.json` (merged over `DEFAULT_DOCKER_POLICY`).

## Defaults

| Key | Default |
|---|---|
| `networkMode` | `none` |
| `repositoryMountMode` | `read-only` |
| `cpuLimit` | `1` |
| `memoryLimitMb` | `1024` |
| `pidsLimit` | `128` |
| `timeoutMs` | `120000` |
| `readOnlyRootFilesystem` | `true` |
| `runAsUser` | `1000:1000` |

## Allowlists

- **Images:** only `issuepilot-node:local`, `issuepilot-python:local` by default
- **Environment:** non-secret keys only (`NODE_ENV`, `CI`, `PATH`, …)
- Sensitive-looking env names/values are rejected

## Escalations

| Request | Effect |
|---|---|
| `requiresWriteAccess` | Mount becomes read-write; risk elevated; **Approval required** |
| `requiresNetwork` | Network becomes `restricted` (bridge); risk high; **Approval required** |

## Forbidden caller fields

`mounts`, `privileged`, `hostNetwork`, `pidMode`, `ipcMode`, `dockerArgs`, `capAdd`, `devices`, …

## Windows / WSL2

- Docker Desktop must be running for integration tests
- Named pipe errors mean the Linux engine is not up
- Prefer absolute repository paths when mounting from Windows hosts
