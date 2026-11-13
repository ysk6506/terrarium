/**
 * What `events_since` shows (REQ-093, ADR-0094 item 4): the run's record cut down to what an operator would see. The
 * alarms that were raised and cleared, a machine that shut itself down, and what the teams the agent handed work to
 * are doing. The agent's own calls, the tickets and above all the faults themselves (the world's truth) stay out. What
 * the system did by itself (a cluster promoting a replica, a hot site switching over: cause `cluster`) shows as
 * `auto_recovery`, so an agent can tell that something is already recovering and leave it alone (REQ-108, ADR-0131).
 * The cursor is a position in the record, so a call with the cursor of the last one gives exactly what is new.
 */
import { withJosa } from "@terrarium/core/kernel";
import { CLUSTER_CAUSE } from "@terrarium/core/physics";
import type { VisibleEvent } from "@terrarium/core/tools";
import type { RunEvent } from "@terrarium/core/world";

/** What the system did by itself, in a few words, for the commands that carry no text of their own. */
const AUTO_TEXT: Readonly<Record<string, string>> = {
  "db.promote": "데이터베이스가 스스로 새 주 인스턴스를 올렸어요",
  "sdn.failover": "SDN 컨트롤러가 스스로 대기 쪽으로 넘어갔어요",
  "dr.failover": "사이트가 스스로 복구 사이트로 넘어가기 시작했어요",
  "dr.complete": "사이트 전환이 스스로 끝났어요",
  "vm.migrate": "VM을 스스로 다른 서버로 옮겼어요",
};
const autoText = (type: string): string => AUTO_TEXT[type] ?? "시스템이 스스로 복구하고 있어요";

/** What the cluster did by itself (not an alarm coming or going), shown so an agent can leave it alone. */
function autoRecovery(e: RunEvent & { kind: "world" }): VisibleEvent | undefined {
  const c = e.command;
  if (e.cause !== CLUSTER_CAUSE || c.type === "alarm.raise" || c.type === "alarm.clear")
    return undefined;
  return { t: e.t, type: "auto_recovery", text: c.type === "note" ? c.text : autoText(c.type) };
}

/** The answer to a request for approval, as the agent reads it (REQ-124); the request itself is the agent's own call and stays out. */
function approvalEvent(e: Extract<RunEvent, { kind: "approval"; what: "answered" }>): VisibleEvent {
  const approved = e.decision === "approved";
  return {
    t: e.t,
    type: approved ? "approval_approved" : "approval_rejected",
    text: `요청 ${e.request}(${e.tool}${e.target ? ` · ${e.target}` : ""}): ${e.because}`,
    request: e.request,
    tool: e.tool,
    target: e.target,
    ...(e.permit ? { expiresAt: e.permit.expiresAt } : {}),
    ...(e.missing.length > 0 ? { missing: e.missing } : {}),
  };
}

export function visibleEvent(
  e: RunEvent,
  nameOf: (id: string) => string,
): VisibleEvent | undefined {
  if (e.kind === "counterpart") {
    const base = { t: e.t, type: e.what, text: e.summary, handoff: e.handoff, domain: e.domain };
    if (e.what === "handed")
      return {
        ...base,
        faults: e.faults.map((f) => ({
          fault: f.faultId,
          type: f.faultType,
          target: f.target,
          doneAt: f.doneAt,
        })),
      };
    return { ...base, entity: e.fault.target, fault: e.fault.faultId, type: e.what };
  }
  if (e.kind === "approval") return e.what === "answered" ? approvalEvent(e) : undefined;
  if (e.kind !== "world") return undefined;
  const c = e.command;
  const auto = autoRecovery(e);
  if (auto) return auto;
  if (c.type === "alarm.raise")
    return {
      t: e.t,
      type: "alarm_raised",
      text: c.alarm.message,
      entity: c.alarm.entityId,
      severity: c.alarm.severity,
      code: c.alarm.code,
    };
  if (c.type === "alarm.clear") {
    const at = c.alarmId.indexOf(":");
    const entity = at > 0 ? c.alarmId.slice(at + 1) : undefined;
    return {
      t: e.t,
      type: "alarm_cleared",
      text: `${entity ? nameOf(entity) : c.alarmId} 알람이 풀렸어요`,
      ...(entity ? { entity } : {}),
      code: at > 0 ? c.alarmId.slice(0, at) : c.alarmId,
    };
  }
  if (c.type === "thermal.shutdown")
    return {
      t: e.t,
      type: "shutdown",
      text: `${withJosa(nameOf(c.target), "이")} 열 때문에 꺼졌어요`,
      entity: c.target,
    };
  return undefined;
}

/** Events after position `cursor`, and the position to ask from next. Nothing from before the agent had the task. */
export function visibleSince(
  events: readonly RunEvent[],
  cursor: number,
  nameOf: (id: string) => string,
): { cursor: number; events: VisibleEvent[] } {
  const start = events.findIndex((e) => e.kind === "score" && e.what === "agent_start");
  const from = Math.max(cursor, start < 0 ? 0 : start + 1);
  return {
    cursor: events.length,
    events: events.slice(from).flatMap((e) => {
      const v = visibleEvent(e, nameOf);
      return v ? [v] : [];
    }),
  };
}
