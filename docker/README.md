# IssuePilot Docker images and security notes

## Images

| Tag | Dockerfile | Base image | Purpose |
|---|---|---|---|
| `issuepilot-node:local` | `fixtures/node/Dockerfile` | `node:24-bookworm-slim` (official, local cache) | Minimal Node for fixtures |
| `issuepilot-python:local` | `fixtures/python/Dockerfile` | `python:3.12-slim-bookworm` (official, local cache) | Minimal Python for fixtures |

Build (when Docker daemon is available):

```powershell
docker build -t issuepilot-node:local docker/fixtures/node
docker build -t issuepilot-python:local docker/fixtures/python
```

If Docker Hub is unreachable, ensure the official base tags already exist locally
(e.g. previously pulled via a trusted mirror). Do not substitute random third-party images.

Runtime still forces `--user 1000:1000` via IssuePilot policy.
Writable scratch is `/tmp` tmpfs only (not under the often read-only `/workspace` mount).

## Non-goals

- No PyTorch / CUDA / GPU
- No Docker socket mount
- No privileged containers
- Images contain no API keys

## Runtime policy

See `config/docker-policy.json` and `docs/execution-policy.md`.
