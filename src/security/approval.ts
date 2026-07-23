import { randomUUID } from "node:crypto";
import type { ApprovalDecision, ApprovalStatus } from "../schema/types.js";
import type { RiskAssessment } from "./assess-risk.js";
import { operationHash } from "./assess-risk.js";

export interface ApprovalRequest {
  taskId: string;
  toolName: string;
  assessment: RiskAssessment;
  input: Record<string, unknown>;
  /** TTL in ms; default 30 minutes. */
  ttlMs?: number;
  requestedAt?: string;
}

export type ApprovalResolver = (req: {
  approvalId: string;
  summary: string;
  level: string;
  operationHash: string;
}) => Promise<"approved" | "rejected">;

export interface ApprovalServiceOptions {
  /** Injected for tests — never use real UI in automated tests. */
  resolver?: ApprovalResolver;
  /** Default deny high when no resolver answers (safe default). */
  defaultDenyHigh?: boolean;
  now?: () => Date;
}

export class ApprovalService {
  private readonly byId = new Map<string, ApprovalDecision>();
  private readonly byHash = new Map<string, string>();
  private readonly resolver?: ApprovalResolver;
  private readonly defaultDenyHigh: boolean;
  private readonly now: () => Date;

  constructor(opts: ApprovalServiceOptions = {}) {
    this.resolver = opts.resolver;
    this.defaultDenyHigh = opts.defaultDenyHigh ?? true;
    this.now = opts.now ?? (() => new Date());
  }

  createPending(req: ApprovalRequest): ApprovalDecision {
    const hash = operationHash(req.toolName, req.assessment, req.input);
    const ttl = req.ttlMs ?? 30 * 60 * 1000;
    const created = this.now();
    const decision: ApprovalDecision = {
      taskId: req.taskId,
      approvalId: randomUUID(),
      approved: false,
      status: "pending",
      approvedBy: null,
      approvedAt: null,
      expiresAt: new Date(created.getTime() + ttl).toISOString(),
      operationHash: hash,
      operationSummary: `${req.toolName}: ${req.assessment.reasons.join("; ")}`,
      approvedActions: [],
      rejectedActions: [],
      comment: null,
    };
    this.byId.set(decision.approvalId, decision);
    this.byHash.set(hash, decision.approvalId);
    return decision;
  }

  get(approvalId: string): ApprovalDecision | undefined {
    const d = this.byId.get(approvalId);
    if (!d) return undefined;
    return this.refreshExpiry(d);
  }

  /**
   * Validate that an existing approval matches this exact operation hash
   * and is not expired.
   */
  validateForOperation(
    approvalId: string,
    toolName: string,
    assessment: RiskAssessment,
    input: Record<string, unknown>,
  ): { ok: boolean; decision?: ApprovalDecision; reason?: string } {
    const d = this.get(approvalId);
    if (!d) return { ok: false, reason: "approval not found" };
    if (d.status === "expired") return { ok: false, decision: d, reason: "approval expired" };
    if (d.status === "rejected") return { ok: false, decision: d, reason: "approval rejected" };
    if (d.status !== "approved" || !d.approved) {
      return { ok: false, decision: d, reason: "approval not granted" };
    }
    const hash = operationHash(toolName, assessment, input);
    if (hash !== d.operationHash) {
      return { ok: false, decision: d, reason: "approval does not match operation" };
    }
    return { ok: true, decision: d };
  }

  findValidApproval(
    toolName: string,
    assessment: RiskAssessment,
    input: Record<string, unknown>,
  ): ApprovalDecision | undefined {
    const hash = operationHash(toolName, assessment, input);
    const id = this.byHash.get(hash);
    if (!id) return undefined;
    const check = this.validateForOperation(id, toolName, assessment, input);
    return check.ok ? check.decision : undefined;
  }

  async decide(
    approvalId: string,
    outcome: "approved" | "rejected",
    by = "user",
    comment: string | null = null,
  ): Promise<ApprovalDecision> {
    const d = this.refreshExpiry(this.byId.get(approvalId));
    if (!d) throw new Error("approval not found");
    if (d.status === "expired") return d;
    const now = this.now().toISOString();
    const next: ApprovalDecision = {
      ...d,
      approved: outcome === "approved",
      status: outcome,
      approvedBy: by,
      approvedAt: now,
      approvedActions: outcome === "approved" ? [d.operationSummary] : [],
      rejectedActions: outcome === "rejected" ? [d.operationSummary] : [],
      comment,
    };
    this.byId.set(approvalId, next);
    return next;
  }

  /**
   * Request approval for medium/high risk. Blocked must never call this.
   * Uses mock/injected resolver; without resolver, high is denied by default.
   */
  async requestApproval(req: ApprovalRequest): Promise<ApprovalDecision> {
    if (req.assessment.blocked || req.assessment.level === "blocked") {
      throw new Error("blocked operations cannot be approved");
    }
    const existing = this.findValidApproval(req.toolName, req.assessment, req.input);
    if (existing) return existing;

    const pending = this.createPending(req);
    if (this.resolver) {
      const outcome = await this.resolver({
        approvalId: pending.approvalId,
        summary: pending.operationSummary,
        level: req.assessment.level,
        operationHash: pending.operationHash,
      });
      return this.decide(pending.approvalId, outcome, "resolver");
    }
    if (req.assessment.level === "high" && this.defaultDenyHigh) {
      return this.decide(pending.approvalId, "rejected", "system", "default deny high");
    }
    if (req.assessment.level === "medium" && this.defaultDenyHigh) {
      return this.decide(pending.approvalId, "rejected", "system", "default deny medium without resolver");
    }
    return pending;
  }

  private refreshExpiry(d: ApprovalDecision | undefined): ApprovalDecision | undefined {
    if (!d) return undefined;
    if (d.status === "pending" || d.status === "approved") {
      if (d.expiresAt && this.now().getTime() > Date.parse(d.expiresAt)) {
        const expired: ApprovalDecision = { ...d, status: "expired", approved: false };
        this.byId.set(d.approvalId, expired);
        return expired;
      }
    }
    return d;
  }
}

export function isApprovalStatus(v: string): v is ApprovalStatus {
  return ["approved", "rejected", "expired", "pending"].includes(v);
}
