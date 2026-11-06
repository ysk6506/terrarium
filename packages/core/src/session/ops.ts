/**
 * What `events_since` shows (REQ-093, ADR-0094 item 4): the run's record cut down to what an operator would see. The
 * alarms that were raised and cleared, a machine that shut itself down, and what the teams the agent handed work to
 * are doing. The agent's own calls, the tickets and above all the faults themselves (the world's truth) stay out. The
 * cursor is a position in the record, so a call with the cursor of the last one gives exactly what is new.
 */
import { withJosa } from "@terrarium/core/kernel";
import type { VisibleEvent } from "@terrarium/core/tools";
import type { RunEvent } from "@terrarium/core/world";

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
  if (e.kind !== "world") return undefined;
  const c = e.command;
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
