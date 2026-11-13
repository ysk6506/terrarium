/**
 * The approvals of a run as the record shows them (REQ-124, ADR-0203), worked out from the run's events and nothing
 * else: each request with its answer, each permit with the call that used it (or none), each call the gate stopped.
 * It is all a screen needs to draw the approvals, and a saved run gives the same lists again.
 */
import type { ApprovalEvent, RunEvent, ToolEvent } from "@terrarium/core/world";
import {
  type ApprovalConfig,
  type ApprovalReport,
  type ApprovalRequestRecord,
  type BlockedRecord,
  type PermitRecord,
  permitSecondsOf,
} from "./model";

type Requested = Extract<ApprovalEvent, { what: "requested" }>;
type Answered = Extract<ApprovalEvent, { what: "answered" }>;

const isApproval = (e: RunEvent): e is ApprovalEvent => e.kind === "approval";

/** One request: what was asked, and the answer if it has come. */
function requestRecord(asked: Requested, answer: Answered | undefined): ApprovalRequestRecord {
  return {
    request: asked.request,
    requestedAt: asked.t,
    tool: asked.tool,
    target: asked.target,
    reason: asked.reason,
    checked: answer?.checked ?? [],
    missing: answer?.missing ?? [],
    ...(answer
      ? {
          answeredAt: answer.t,
          decision: answer.decision,
          because: answer.because,
          waitedSeconds: answer.waitedSeconds,
        }
      : {}),
  };
}

/** The approvals, the permits and the blocked calls of a run. */
export function approvalReport(events: readonly RunEvent[], config: ApprovalConfig): ApprovalReport {
  const approvals = events.filter(isApproval);
  const answers = new Map<string, Answered>();
  for (const e of approvals) if (e.what === "answered") answers.set(e.request, e);
  const requests = approvals.flatMap((e) =>
    e.what === "requested" ? [requestRecord(e, answers.get(e.request))] : [],
  );
  const calls = events.filter((e): e is ToolEvent => e.kind === "tool");
  const usedBy = (request: string): number | undefined =>
    calls.find((c) => c.permits?.includes(request))?.seq;
  const permits = [...answers.values()].flatMap((a): PermitRecord[] => {
    if (!a.permit) return [];
    const used = usedBy(a.request);
    return [
      {
        request: a.request,
        tool: a.tool,
        target: a.target,
        grantedAt: a.t,
        expiresAt: a.permit.expiresAt,
        ...(used === undefined ? {} : { usedBy: used }),
      },
    ];
  });
  const blocked = calls.flatMap((c): BlockedRecord[] =>
    c.blockedBy ? [{ seq: c.seq, t: c.t, tool: c.tool, targets: c.targets, by: c.blockedBy }] : [],
  );
  return {
    rule: config.rule,
    approver: config.approver,
    permitSeconds: permitSecondsOf(config),
    requests,
    permits,
    blocked,
  };
}
