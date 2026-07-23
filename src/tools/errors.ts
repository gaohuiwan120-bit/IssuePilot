export const ISSUE_TOOL_ERROR_CODES = [
  "INVALID_INPUT",
  "INVALID_TASK_ID",
  "INVALID_REPOSITORY_PATH",
  "PATH_OUTSIDE_REPOSITORY",
  "SENSITIVE_PATH",
  "FILE_LIMIT_EXCEEDED",
  "READ_LIMIT_EXCEEDED",
  "COMMAND_BLOCKED",
  "DOCKER_UNAVAILABLE",
  "REPRODUCTION_INCOMPLETE",
  "VALIDATION_NOT_EXECUTED",
  "GIT_ERROR",
  "ARTIFACT_WRITE_FAILED",
  "NOT_A_GIT_REPOSITORY",
] as const;

export type IssueToolErrorCode = (typeof ISSUE_TOOL_ERROR_CODES)[number];

export class IssueToolError extends Error {
  readonly code: IssueToolErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: IssueToolErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "IssueToolError";
    this.code = code;
    this.details = details;
  }
}
