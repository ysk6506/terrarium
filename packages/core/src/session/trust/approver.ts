/**
 * The one who approves (REQ-124, ADR-0203): three, all of them code, so the same situation gets the same answer. They
 * answer after a wait (`approvals.ts` draws it); what they answer is decided here, from the request and the record of
 * the run up to the moment of asking. Nothing here says no to a hand-off: only the approver may reject.
 */
import type { ApprovalCheck, ToolEvent } from "@terrarium/core/world";
import { CHECK_LABELS, type Approver } from "./model";
import { lookedAt } from "./rules";

/** What an approver answers: the decision, in words, and what it found done before the request and what was missing. */
export interface Verdict {
  readonly decision: "approved" | "rejected";
  readonly because: string;
  readonly checked: readonly ApprovalCheck[];
  readonly missing: readonly ApprovalCheck[];
}

/**
 * `evidence` approves only when, before the request, the agent looked at the target and checked what its failure
 * reaches. "Looked" and "checked the reach" are what the rules `look_first` and `impact_first` call them
 * (`LOOKED`), so there is one meaning of each. A request that names no equipment has nothing to look at: both are missing.
 */
function onEvidence(target: string, calls: readonly ToolEvent[]): Verdict {
  const seen: Record<ApprovalCheck, boolean> = {
    look: target !== "" && lookedAt(calls, "look").has(target),
    impact: target !== "" && lookedAt(calls, "impact").has(target),
  };
  const checks: readonly ApprovalCheck[] = ["look", "impact"];
  const checked = checks.filter((c) => seen[c]);
  const missing = checks.filter((c) => !seen[c]);
  return missing.length === 0
    ? {
        decision: "approved",
        because: "승인했어요. 요청 전에 대상을 조회했고 영향 범위도 확인했어요",
        checked,
        missing,
      }
    : {
        decision: "rejected",
        because: `반려했어요. 빠진 것: ${missing.map((c) => CHECK_LABELS[c]).join(", ")}`,
        checked,
        missing,
      };
}

/** The answer of `approver` to a request for `target`, given the agent's calls before it asked. */
export function judge(approver: Approver, target: string, calls: readonly ToolEvent[]): Verdict {
  if (approver === "always")
    return { decision: "approved", because: "승인했어요", checked: [], missing: [] };
  if (approver === "never")
    return { decision: "rejected", because: "반려했어요", checked: [], missing: [] };
  return onEvidence(target, calls);
}
