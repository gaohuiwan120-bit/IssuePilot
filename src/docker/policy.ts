import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { DockerExecutionPolicy } from "./types.js";

/** Built-in safe defaults — overridable via config/docker-policy.json */
export const DEFAULT_DOCKER_POLICY: DockerExecutionPolicy = {
  image: "issuepilot-node:local",
  workingDirectory: "/workspace",
  repositoryMountMode: "read-only",
  networkMode: "none",
  cpuLimit: 1,
  memoryLimitMb: 1024,
  pidsLimit: 128,
  timeoutMs: 120_000,
  readOnlyRootFilesystem: true,
  runAsUser: "1000:1000",
  allowedEnvironmentVariables: [
    "PATH",
    "HOME",
    "LANG",
    "LC_ALL",
    "NODE_ENV",
    "CI",
    "ISSUEPILOT_TASK_ID",
    "PYTHONUNBUFFERED",
    "PYTHONDONTWRITEBYTECODE",
  ],
  writableDirectories: ["/tmp"],
  allowedImages: [
    "issuepilot-node:local",
    "issuepilot-python:local",
  ],
  containerWorkspacePath: "/workspace",
};

export function loadDockerPolicy(configPath?: string): DockerExecutionPolicy {
  const path = configPath ?? join(process.cwd(), "config", "docker-policy.json");
  if (!existsSync(path)) {
    return { ...DEFAULT_DOCKER_POLICY };
  }
  const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<DockerExecutionPolicy>;
  return {
    ...DEFAULT_DOCKER_POLICY,
    ...raw,
    allowedEnvironmentVariables:
      raw.allowedEnvironmentVariables ?? DEFAULT_DOCKER_POLICY.allowedEnvironmentVariables,
    writableDirectories: raw.writableDirectories ?? DEFAULT_DOCKER_POLICY.writableDirectories,
    allowedImages: raw.allowedImages ?? DEFAULT_DOCKER_POLICY.allowedImages,
  };
}
