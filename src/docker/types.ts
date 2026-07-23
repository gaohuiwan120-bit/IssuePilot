export const DOCKER_ERROR_CODES = [
  "DOCKER_UNAVAILABLE",
  "IMAGE_NOT_ALLOWED",
  "INVALID_REPOSITORY_PATH",
  "INVALID_WORKING_DIRECTORY",
  "COMMAND_BLOCKED",
  "APPROVAL_REQUIRED",
  "APPROVAL_INVALID",
  "NETWORK_NOT_ALLOWED",
  "WRITE_ACCESS_NOT_ALLOWED",
  "CONTAINER_CREATE_FAILED",
  "CONTAINER_START_FAILED",
  "EXECUTION_TIMEOUT",
  "EXECUTION_FAILED",
  "OUTPUT_WRITE_FAILED",
  "CONTAINER_CLEANUP_FAILED",
  "INVALID_TASK_ID",
  "INVALID_ENVIRONMENT",
  "INVALID_REQUEST",
  "POLICY_VIOLATION",
] as const;

export type DockerErrorCode = (typeof DOCKER_ERROR_CODES)[number];

export class DockerExecutionError extends Error {
  readonly code: DockerErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: DockerErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "DockerExecutionError";
    this.code = code;
    this.details = details;
  }
}

export type ExecutionType =
  | "test"
  | "lint"
  | "build"
  | "typecheck"
  | "reproduce"
  | "custom-approved";

export interface ExecutionRequest {
  taskId: string;
  executionType: ExecutionType;
  image: string;
  /** Argv array — never a raw shell string. */
  command: string[];
  repositoryPath: string;
  workingDirectory: string;
  environment: Record<string, string>;
  timeoutMs?: number;
  requiresWriteAccess: boolean;
  requiresNetwork?: boolean;
  approvalId?: string;
}

export interface ExecutionResult {
  taskId: string;
  executionId: string;
  executionType: string;
  image: string;
  command: string[];
  exitCode: number | null;
  success: boolean;
  timedOut: boolean;
  durationMs: number;
  stdoutSummary: string;
  stderrSummary: string;
  stdoutArtifactPath?: string;
  stderrArtifactPath?: string;
  cleanupSucceeded: boolean;
  errorCode?: DockerErrorCode;
  errorMessage?: string;
  containerName?: string;
  appliedPolicy?: {
    networkMode: string;
    repositoryMountMode: string;
    readOnlyRootFilesystem: boolean;
    runAsUser: string;
    cpuLimit: number;
    memoryLimitMb: number;
    pidsLimit: number;
  };
}

export interface DockerExecutionPolicy {
  image: string;
  workingDirectory: string;
  repositoryMountMode: "read-only" | "read-write";
  networkMode: "none" | "restricted";
  cpuLimit: number;
  memoryLimitMb: number;
  pidsLimit: number;
  timeoutMs: number;
  readOnlyRootFilesystem: boolean;
  runAsUser: string;
  allowedEnvironmentVariables: string[];
  writableDirectories: string[];
  allowedImages: string[];
  containerWorkspacePath: string;
}
