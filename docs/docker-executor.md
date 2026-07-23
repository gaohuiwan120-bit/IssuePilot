# Docker Executor (Phase M2B)

## Architecture

```text
Tool Call (run_in_docker)
  → Permission / command risk assessment
  → Approval (when write/network/high risk)
  → Docker policy validation (image, env, paths, mounts)
  → Workflow limits
  → Ephemeral `docker run` (fixed safe flags only)
  → Timeout / kill
  → Collect stdout/stderr/exitCode
  → Artifact logs + run_trace.jsonl
  → Best-effort container cleanup (--rm + rm -f)
```

Core modules:

| Module | Role |
|---|---|
| `src/docker/policy.ts` | Defaults + `config/docker-policy.json` |
| `src/docker/validate.ts` | Request validation + argv builder |
| `src/docker/executor.ts` | Ephemeral execution + cleanup |
| `src/docker/availability.ts` | Daemon / image probes |
| `extensions/docker-executor.ts` | Pi tool wiring |

## Implemented

- Ephemeral one-shot containers
- Network default `none`
- Repository mount default read-only
- Non-root user, read-only rootfs, cap-drop ALL, no-new-privileges
- CPU / memory / pids / timeout
- Allowlisted images and environment variables
- Structured `ExecutionResult` + error codes
- Integration with M2A Approval + RunRecorder + WorkflowLimits
- Unit tests without Docker daemon
- Integration tests that **skip** (not fake-pass) when Docker is down

## Not implemented

- Long-lived containers / pools / Compose per issue / Kubernetes / GPU
- Issue business tools / Skills / PR creation / real model calls
- Automatic git branch/rollback of user repos

## Security note

**Docker is not an absolute security boundary.** It reduces blast radius but does not replace Permission Gate, Approval, or host OS controls. Escape risks, misconfigured daemons, and Windows/WSL path semantics remain.

## Calling from future Issue tools

```ts
const executor = new DockerExecutor({ approvalService, policy: loadDockerPolicy() });
await executor.execute({
  taskId,
  executionType: "test",
  image: "issuepilot-node:local",
  command: ["npm", "test"],
  repositoryPath,
  workingDirectory: repositoryPath,
  environment: { NODE_ENV: "test" },
  requiresWriteAccess: false,
  requiresNetwork: false,
});
```

Commands must be argv arrays. Callers cannot pass mounts, privileged, host network, or arbitrary docker flags.
