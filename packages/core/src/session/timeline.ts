/**
 * What happened during a run, in order, for the result page (REQ-037): scenario steps, monitoring
 * alarms and the agent's tool calls on one simulated-time axis.
 */
import {
  ACTION_LABELS,
  blockSpec,
  minutesText,
  type ScenarioDoc,
  type ToolCallRecord,
  type TraceEntry,
} from "@terrarium/core/scenario";
import { type FaultType, faultSpec, isFaultType, type WorldEvent } from "@terrarium/core/world";

export type TimelineSource = "scenario" | "alarm" | "agent";

export interface TimelineEntry {
  readonly t: number;
  readonly source: TimelineSource;
  readonly text: string;
  readonly severity?: "warning" | "critical";
  readonly nodeId?: string;
  readonly entityId?: string;
}

const WHAT: Readonly<Record<TraceEntry["what"], string>> = {
  ran: "",
  waiting: "시작",
  resumed: "끝",
  met: "조건 충족",
  timeout: "시간 초과",
  chose: "선택",
  expired: "고장 자동 복구",
  error: "실행 못 함",
};

/** How an entity is named on screen; without a lookup, by its id. */
export type NameOf = (id: string) => string;

function scenarioText(doc: ScenarioDoc, entry: TraceEntry, nameOf: NameOf): string {
  const node = doc.nodes.find((n) => n.id === entry.nodeId);
  const label = node?.label ?? blockSpec(node?.type ?? "")?.label ?? entry.nodeId;
  const target = typeof node?.params.target === "string" ? nameOf(node.params.target) : undefined;
  const fault = node?.params.faultType;
  const head =
    node?.type === "inject_fault" && typeof fault === "string" && isFaultType(fault)
      ? `${faultSpec(fault as FaultType).label} 발생`
      : label;
  const base = [head, target ? `(${target})` : "", WHAT[entry.what]].filter(Boolean).join(" ");
  const detail =
    entry.what === "chose"
      ? choiceText(node?.type, entry.detail)
      : entry.what === "expired"
        ? undefined // the detail is the fault's internal id
        : entry.detail;
  return detail ? `${base}: ${detail}` : base;
}

function choiceText(type: string | undefined, detail: string | undefined): string | undefined {
  if (type === "branch") return detail === "yes" ? "예" : "아니오";
  return detail === undefined ? undefined : `${detail}번 갈래`;
}

function callText(call: ToolCallRecord): string {
  const waited = call.tool === "wait" ? call.args.seconds : undefined;
  if (call.ok && typeof waited === "number") return `${minutesText(waited)} 기다려요`;
  const effects = (call.effects ?? []).map((e) => `${e.target} ${ACTION_LABELS[e.action]}`);
  const head = `${call.tool}${Object.keys(call.args).length > 0 ? ` ${JSON.stringify(call.args)}` : ""}`;
  if (!call.ok) return `${head} — 실패: ${call.error ?? "알 수 없음"}`;
  return effects.length > 0 ? `${head} → ${effects.join(", ")}` : head;
}

const ORDER: Readonly<Record<TimelineSource, number>> = { scenario: 0, alarm: 1, agent: 2 };

export function buildTimeline(
  doc: ScenarioDoc,
  trace: readonly TraceEntry[],
  events: readonly WorldEvent[],
  calls: readonly ToolCallRecord[],
  sinceT: number,
  nameOf: NameOf = (id) => id,
): TimelineEntry[] {
  const out: TimelineEntry[] = trace.map((entry) => ({
    t: entry.t,
    source: "scenario",
    text: scenarioText(doc, entry, nameOf),
    nodeId: entry.nodeId,
  }));
  const messages = new Map<string, string>();
  for (const e of events) {
    if (e.type === "alarm.raise") {
      messages.set(e.alarm.id, e.alarm.message);
      if (e.t >= sinceT)
        out.push({
          t: e.t,
          source: "alarm",
          text: e.alarm.message,
          severity: e.alarm.severity,
          entityId: e.alarm.entityId,
        });
    } else if (e.type === "alarm.clear" && e.t >= sinceT) {
      out.push({ t: e.t, source: "alarm", text: `복구: ${messages.get(e.alarmId) ?? e.alarmId}` });
    }
  }
  for (const call of calls) out.push({ t: call.t, source: "agent", text: callText(call) });
  return out
    .map((entry, i) => ({ entry, i }))
    .sort(
      (a, b) => a.entry.t - b.entry.t || ORDER[a.entry.source] - ORDER[b.entry.source] || a.i - b.i,
    )
    .map(({ entry }) => entry);
}
