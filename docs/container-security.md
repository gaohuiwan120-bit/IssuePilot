# Container Security Model

## Guarantees (best effort)

1. No Docker socket mounts
2. No privileged mode
3. No host network / host PID / host IPC knobs exposed
4. Capabilities dropped (`--cap-drop ALL`)
5. `no-new-privileges`
6. Read-only root filesystem + tmpfs for `/tmp`
7. Non-root `runAsUser`
8. Ephemeral containers with `--rm` and best-effort `docker rm -f`
9. Never runs `docker system/container/volume prune`

## Non-guarantees

- Kernel exploits / Docker Desktop bugs
- Malicious allowlisted image contents (build only from this repo’s Dockerfiles)
- Host misconfiguration
- Absolute isolation from a determined local attacker with host access

## Mount rules

- Only the target repository is mounted to `/workspace`
- Default `:ro`
- Never mount `$HOME`, SSH dirs, or credential stores
- Never mount `pi-upstream`

## Logging

- Trace stores summaries + artifact paths only
- Large stdout/stderr spill to `outputs/<task-id>/logs/`
- Env vars and secrets are not dumped into traces
