import { createHash } from "node:crypto";
import { isAbsolute, normalize, resolve, sep } from "node:path";
import type { RiskLevel } from "../risk/levels.js";
import { requiresApprovalForRisk } from "../risk/levels.js";
import { normalizeCommand } from "./normalize.js";

export interface RiskAssessment {
  level: RiskLevel;
  operation: string;
  reasons: string[];
  requiresApproval: boolean;
  blocked: boolean;
  normalizedCommand?: string;
  affectedPaths: string[];
}

export interface AssessToolCallInput {
  toolName: string;
  input: Record<string, unknown>;
  /** Repository / task workspace root. */
  workspaceRoot: string;
  /** Optional absolute paths that must never be written (e.g. pi-upstream). */
  forbiddenRoots?: string[];
}

const SENSITIVE_FILE_RE =
  /(^|[\\/])(\.env(\..+)?|.*\.(pem|key|p12|pfx)|id_rsa|id_ed25519|credentials\.json|auth\.json|secrets?\.(json|ya?ml)|docker\.sock)([\\/]|$)/i;

const BLOCKED_COMMAND_PATTERNS: Array<{ re: RegExp; reason: string }> = [
  { re: /\brm\s+(-[a-z]*f[a-z]*\s+|--force).*(\/|\\|\*)/i, reason: "destructive recursive delete" },
  { re: /\brm\s+(-rf|--recursive)\s+(\/|~|\/\*|\\\*)/i, reason: "rm -rf of root or home" },
  { re: /\bgit\s+reset\s+--hard\b/i, reason: "git reset --hard is blocked" },
  { re: /\bgit\s+clean\s+(-[a-z]*f|-fd|-ffd|-[a-z]*d[a-z]*f)/i, reason: "git clean force is blocked" },
  { re: /\bsudo\b/i, reason: "sudo / privilege escalation is blocked" },
  { re: /docker\.sock/i, reason: "docker socket access is blocked" },
  { re: /\bgit\s+push\s+.*--force\b/i, reason: "force push is blocked" },
  { re: /\bchmod\s+(-R\s+)?777\b/i, reason: "world-writable chmod blocked" },
  { re: /\b(curl|wget)\b.*\|\s*(ba)?sh\b/i, reason: "pipe remote script to shell blocked" },
  { re: /\b(eval|exec)\s*\(/i, reason: "dynamic eval/exec blocked" },
  { re: /\bunset\s+(CI|FORCE_COLOR)\b/i, reason: "tampering with CI env blocked" },
  { re: /\bnpm\s+(test|run)\s+.*--(--)?passWithNoTests\b/i, reason: "bypassing tests blocked" },
];

const HIGH_COMMAND_PATTERNS: Array<{ re: RegExp; reason: string }> = [
  { re: /\b(npm|pnpm|yarn|bun)\s+(i|install|add|update|upgrade)\b/i, reason: "dependency install/upgrade" },
  { re: /\bpip(\d)?\s+install\b/i, reason: "python dependency install" },
  { re: /\b(go|cargo)\s+(get|install|add)\b/i, reason: "language dependency install" },
  { re: /\bcurl\b|\bwget\b|\binvoke-webrequest\b/i, reason: "network access" },
  { re: /\b(prisma|knex|sequelize|django|alembic|flyway|liquibase)\b.*\b(migrate|migration)\b/i, reason: "database migration" },
  { re: /\b(rm|del|Remove-Item)\b/i, reason: "file deletion" },
  { re: /\bpackage-lock\.json\b|\byarn\.lock\b|\bpnpm-lock\.yaml\b/i, reason: "lockfile modification" },
  { re: /\.github\/workflows\b|\.gitlab-ci\b|Jenkinsfile\b/i, reason: "CI/CD config change" },
  { re: /\b(export|setx?)\s+[A-Z0-9_]+=/i, reason: "environment variable modification" },
];

const MEDIUM_COMMAND_PATTERNS: Array<{ re: RegExp; reason: string }> = [
  { re: /\bgit\s+checkout\s+-b\b|\bgit\s+switch\s+-c\b|\bgit\s+branch\b/i, reason: "create git branch" },
  { re: /\b(npm|pnpm|yarn)\s+run\s+build\b|\bnpm\s+run\s+compile\b/i, reason: "non-destructive build" },
  { re: /\btsc\b|\bwavelength\b/i, reason: "build/compile" },
];

function extractPathsFromInput(toolName: string, input: Record<string, unknown>): string[] {
  const keys = ["path", "file", "filePath", "filepath", "target", "dest", "destination"];
  const out: string[] = [];
  for (const k of keys) {
    const v = input[k];
    if (typeof v === "string" && v.trim()) out.push(v);
  }
  if (Array.isArray(input.paths)) {
    for (const p of input.paths) if (typeof p === "string") out.push(p);
  }
  if (toolName === "bash" && typeof input.command === "string") {
    const m = input.command.match(/(?:^|\s)((?:\.\.\/)+[^\s"']+|[A-Za-z]:\\[^\s"']+|\/[^\s"']+)/g);
    if (m) {
      for (const hit of m) out.push(hit.trim());
    }
  }
  return out;
}

export function resolveWorkspacePath(workspaceRoot: string, candidate: string): string {
  const root = resolve(workspaceRoot);
  const abs = isAbsolute(candidate) ? resolve(candidate) : resolve(root, candidate);
  return normalize(abs);
}

export function isPathInside(root: string, candidate: string): boolean {
  const r = resolve(root);
  const c = resolve(candidate);
  if (c === r) return true;
  const prefix = r.endsWith(sep) ? r : r + sep;
  return c.toLowerCase().startsWith(prefix.toLowerCase());
}

export function hasPathTraversal(rawPath: string): boolean {
  const n = normalize(rawPath);
  return n.split(/[\\/]/).includes("..") || rawPath.includes("\0");
}

function maxLevel(a: RiskLevel, b: RiskLevel): RiskLevel {
  const order: RiskLevel[] = ["low", "medium", "high", "blocked"];
  return order[Math.max(order.indexOf(a), order.indexOf(b))]!;
}

/**
 * Pure risk assessment for a tool call. No UI / no side effects.
 */
export function assessToolCall(opts: AssessToolCallInput): RiskAssessment {
  const { toolName, input, workspaceRoot } = opts;
  const forbiddenRoots = opts.forbiddenRoots ?? [];
  const reasons: string[] = [];
  let level: RiskLevel = "low";
  const affectedPaths: string[] = [];
  let normalizedCommand: string | undefined;

  const paths = extractPathsFromInput(toolName, input);
  for (const p of paths) {
    if (hasPathTraversal(p)) {
      return {
        level: "blocked",
        operation: `${toolName}`,
        reasons: [`path traversal detected: ${p}`],
        requiresApproval: false,
        blocked: true,
        affectedPaths: [p],
      };
    }
    const resolved = resolveWorkspacePath(workspaceRoot, p);
    affectedPaths.push(resolved);
    if (!isPathInside(workspaceRoot, resolved)) {
      return {
        level: "blocked",
        operation: `${toolName}`,
        reasons: [`path outside workspace: ${p}`],
        requiresApproval: false,
        blocked: true,
        affectedPaths,
        normalizedCommand,
      };
    }
    for (const fr of forbiddenRoots) {
      if (isPathInside(fr, resolved)) {
        return {
          level: "blocked",
          operation: `${toolName}`,
          reasons: [`forbidden root access: ${fr}`],
          requiresApproval: false,
          blocked: true,
          affectedPaths,
        };
      }
    }
    if (SENSITIVE_FILE_RE.test(p) || SENSITIVE_FILE_RE.test(resolved)) {
      return {
        level: "blocked",
        operation: `${toolName}`,
        reasons: ["sensitive credential/env file access is blocked"],
        requiresApproval: false,
        blocked: true,
        affectedPaths,
      };
    }
  }

  if (toolName === "read" || toolName === "grep") {
    return {
      level: "low",
      operation: toolName,
      reasons: ["read-only tool"],
      requiresApproval: false,
      blocked: false,
      affectedPaths,
    };
  }

  if (toolName === "edit" || toolName === "write") {
    const pathStr = String(input.path ?? input.filePath ?? "");
    if (/\.(ya?ml|json|toml|ini|config)$/i.test(pathStr) && !/\.test\./i.test(pathStr)) {
      level = "high";
      reasons.push("config file modification");
    } else if (/test|spec/i.test(pathStr)) {
      level = "medium";
      reasons.push("test file write");
    } else {
      level = "medium";
      reasons.push("source file modification");
    }
    // Large refactor heuristic: very large content
    const content = String(input.content ?? input.newText ?? "");
    if (content.length > 50_000) {
      level = maxLevel(level, "high");
      reasons.push("large-scale content change");
    }
  }

  if (toolName === "bash") {
    const raw = String(input.command ?? "");
    normalizedCommand = normalizeCommand(raw);
    for (const { re, reason } of BLOCKED_COMMAND_PATTERNS) {
      if (re.test(normalizedCommand) || re.test(raw)) {
        return {
          level: "blocked",
          operation: "bash",
          reasons: [reason],
          requiresApproval: false,
          blocked: true,
          normalizedCommand,
          affectedPaths,
        };
      }
    }
    for (const { re, reason } of HIGH_COMMAND_PATTERNS) {
      if (re.test(normalizedCommand) || re.test(raw)) {
        level = maxLevel(level, "high");
        reasons.push(reason);
      }
    }
    for (const { re, reason } of MEDIUM_COMMAND_PATTERNS) {
      if (re.test(normalizedCommand) || re.test(raw)) {
        level = maxLevel(level, "medium");
        reasons.push(reason);
      }
    }
    if (/\bnpm\s+test\b|\bpytest\b|\bgo\s+test\b/i.test(normalizedCommand)) {
      if (level === "low") {
        reasons.push("approved-style test command");
      }
    }
    if (/\bgit\s+diff\b|\bgit\s+status\b|\bgit\s+log\b/i.test(normalizedCommand)) {
      // stay low unless elevated
      if (level === "low") reasons.push("read-only git inspection");
    }
  }

  if (reasons.length === 0) reasons.push("default classification");

  const blocked = level === "blocked";
  return {
    level,
    operation: toolName,
    reasons,
    requiresApproval: !blocked && requiresApprovalForRisk(level),
    blocked,
    normalizedCommand,
    affectedPaths,
  };
}

export function operationHash(
  toolName: string,
  assessment: RiskAssessment,
  input: Record<string, unknown>,
): string {
  const payload = JSON.stringify({
    toolName,
    normalizedCommand: assessment.normalizedCommand ?? null,
    affectedPaths: assessment.affectedPaths.slice().sort(),
    // Stable subset of params (avoid huge content)
    path: input.path ?? input.filePath ?? null,
    command: assessment.normalizedCommand ?? input.command ?? null,
  });
  return createHash("sha256").update(payload).digest("hex");
}
