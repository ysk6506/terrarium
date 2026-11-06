/**
 * What a run handed to other teams, in words (REQ-093, ADR-0098 item 5, ADR-0099): the list of hand-offs with each
 * fault's wait and how far it is, the board of tickets, and the four things the measurement says about the wait.
 * All of it is read from the run's events and its hand-off report, so a live run and a finished one read the same.
 */
import type { HandoffReport, HandoffRow } from "@terrarium/core/oracle";
import {
  type CounterpartEvent,
  type Domain,
  domainInfo,
  type FaultType,
  faultSpec,
  formatSpan,
  type RunEvent,
  type TicketSnapshot,
  type TicketStatus,
} from "@terrarium/core/world";

export const HANDOFF_WORDS = {
  title: "넘긴 일",
  none: "이 실행에서는 다른 팀에 넘긴 일이 없어요",
  noFault: "넘길 때 그 도메인에 고장이 없었어요",
  columns: { domain: "도메인", fault: "고장", eta: "예상", progress: "진행", done: "끝난 때" },
  tickets: "작업 티켓",
  ticketsNone: "티켓이 아직 없어요",
  measure: "기다리는 동안",
} as const;

export type FaultProgress = "waiting" | "working" | "done";

export const PROGRESS_LABELS: Readonly<Record<FaultProgress, string>> = {
  waiting: "기다리는 중",
  working: "작업 중",
  done: "끝났어요",
};

export interface FaultLine {
  readonly faultId: string;
  readonly label: string;
  readonly target: string;
  readonly eta: string;
  readonly progress: FaultProgress;
  /** Who works on it now or did: "벤더", "서버 팀". */
  readonly who: string;
  readonly doneText?: string;
}

export interface HandoffBlock {
  readonly id: string;
  readonly domain: string;
  readonly team: string;
  readonly note?: string;
  readonly handedText: string;
  readonly faults: readonly FaultLine[];
}

const labelOf = (type: string): string => {
  try {
    return faultSpec(type as FaultType).label;
  } catch {
    return type;
  }
};

const isCounterpart = (e: RunEvent): e is CounterpartEvent => e.kind === "counterpart";

/** Where the run's clock starts: the scenario's first step, so "3시간 뒤" counts from the beginning. */
export function originOf(events: readonly RunEvent[]): number {
  const start = events.find((e) => e.kind === "score" && e.what === "agent_start");
  return start?.kind === "score" && start.what === "agent_start" ? start.scenarioStart : 0;
}

/** The hand-offs of a run with each fault's progress at the end of what is recorded. */
export function handoffBlocks(
  events: readonly RunEvent[],
  nameOf: (id: string) => string,
): HandoffBlock[] {
  const origin = originOf(events);
  const cp = events.filter(isCounterpart);
  const progress = new Map<string, { started?: number; done?: number }>();
  for (const e of cp)
    if (e.what !== "handed")
      progress.set(e.fault.faultId, {
        ...progress.get(e.fault.faultId),
        [e.what === "started" ? "started" : "done"]: e.t,
      });
  return cp.flatMap((e): HandoffBlock[] => {
    if (e.what !== "handed") return [];
    return [
      {
        id: e.handoff,
        domain: domainInfo(e.domain).label,
        team: e.team,
        ...(e.note ? { note: e.note } : {}),
        handedText: `시작 ${formatSpan(Math.max(0, e.t - origin))} 뒤에 넘겼어요`,
        faults: e.faults.map((f): FaultLine => {
          const p = progress.get(f.faultId);
          const state: FaultProgress =
            p?.done !== undefined ? "done" : p?.started !== undefined ? "working" : "waiting";
          return {
            faultId: f.faultId,
            label: labelOf(f.faultType),
            target: nameOf(f.target),
            eta: formatSpan(f.etaSeconds),
            progress: state,
            who: f.who === "vendor" ? "벤더" : e.team,
            ...(p?.done !== undefined
              ? { doneText: `${formatSpan(Math.max(0, p.done - origin))} 지났을 때` }
              : {}),
          };
        }),
      },
    ];
  });
}

export interface TicketCard {
  readonly id: string;
  readonly title: string;
  readonly detail: string;
  readonly auto: boolean;
}

export const TICKET_COLUMNS: ReadonlyArray<{ readonly id: TicketStatus; readonly label: string }> =
  [
    { id: "mine", label: "내가 할 것" },
    { id: "waiting", label: "기다리는 중" },
    { id: "done", label: "끝남" },
  ];

function detailOf(t: TicketSnapshot, origin: number): string {
  if (t.status === "waiting") {
    const due =
      t.dueAt === undefined ? "" : `, ${formatSpan(Math.max(0, t.dueAt - origin))} 지났을 때까지`;
    return `${t.waitingFor ?? "누군가"}를 기다려요${due}`;
  }
  return t.note ?? "";
}

/** The latest of each ticket, in the column of its status. */
export function ticketBoard(events: readonly RunEvent[]): Record<TicketStatus, TicketCard[]> {
  const origin = originOf(events);
  const latest = new Map<string, { ticket: TicketSnapshot; auto: boolean }>();
  for (const e of events)
    if (e.kind === "ticket") latest.set(e.ticket.id, { ticket: e.ticket, auto: e.auto });
  const board: Record<TicketStatus, TicketCard[]> = { mine: [], waiting: [], done: [] };
  for (const { ticket, auto } of latest.values())
    board[ticket.status].push({
      id: ticket.id,
      title: ticket.title,
      detail: detailOf(ticket, origin),
      auto,
    });
  return board;
}

export const hasTickets = (events: readonly RunEvent[]): boolean =>
  events.some((e) => e.kind === "ticket");

export interface MeasureLine {
  readonly label: string;
  readonly value: string;
  /** Good, bad, or just a fact. */
  readonly tone: "good" | "bad" | "plain";
}

function bridgeLine(r: HandoffRow): MeasureLine {
  const label = "임시 조치";
  const wait = formatSpan(Math.max(0, (r.doneAt ?? r.at) - r.at));
  if (r.bridge.impaired === 0)
    return { label, value: "넘길 때 멈춘 서비스가 없었어요", tone: "plain" };
  if (r.bridge.savedAfterSeconds !== undefined)
    return {
      label,
      value: `일을 맡은 지 ${formatSpan(r.bridge.savedAfterSeconds)} 만에 서비스를 살렸어요. 팀은 ${wait} 뒤에 끝냈어요`,
      tone: "good",
    };
  if (r.bridge.acted)
    return {
      label,
      value: `조치는 했지만 팀이 끝낼 때까지 서비스가 돌아오지 않았어요 (${wait})`,
      tone: "bad",
    };
  return {
    label,
    value: `넘기고 기다리기만 했어요. 서비스가 ${wait} 동안 멈춰 있었어요`,
    tone: "bad",
  };
}

function cleanupLine(r: HandoffRow): MeasureLine {
  const label = "마무리";
  const { needed, done, lateSeconds } = r.cleanup;
  if (needed === 0) return { label, value: "되돌릴 임시 조치가 없었어요", tone: "plain" };
  if (done === 0) return { label, value: `임시 조치 ${needed}건을 되돌리지 않았어요`, tone: "bad" };
  const late = lateSeconds === undefined ? "" : ` (끝난 지 ${formatSpan(lateSeconds)} 뒤)`;
  return {
    label,
    value:
      done >= needed
        ? `임시 조치 ${needed}건을 모두 되돌렸어요${late}`
        : `임시 조치 ${needed}건 중 ${done}건만 되돌렸어요${late}`,
    tone: done >= needed ? "good" : "bad",
  };
}

function meanwhileLine(r: HandoffRow): MeasureLine {
  const label = "동시 작업";
  const { alarms, looked, calls } = r.meanwhile;
  if (alarms === 0)
    return { label, value: `기다리는 동안 새 알람이 없었어요 (툴 호출 ${calls}번)`, tone: "plain" };
  return {
    label,
    value: `새 알람 ${alarms}개 중 ${looked}개를 살펴봤어요`,
    tone: looked >= alarms ? "good" : "bad",
  };
}

/** The four things a hand-off is measured by, for each hand-off of the report. */
export function measureLines(report: HandoffReport): ReadonlyArray<{
  readonly id: string;
  readonly team: string;
  readonly lines: readonly MeasureLine[];
}> {
  return report.rows.map((r) => {
    const needless = r.faults.filter((f) => f.needless).length;
    const reason: MeasureLine =
      r.faults.length === 0
        ? { label: "넘긴 근거", value: "그 도메인에 고장이 없는데 넘겼어요", tone: "bad" }
        : needless > 0
          ? {
              label: "넘긴 근거",
              value: `${needless}건은 내 도메인 툴로 풀 수 있는 고장이었어요`,
              tone: "bad",
            }
          : { label: "넘긴 근거", value: "모두 내 도메인 밖의 고장이었어요", tone: "good" };
    return {
      id: r.id,
      team: r.team,
      lines: [bridgeLine(r), cleanupLine(r), meanwhileLine(r), reason],
    };
  });
}

/** Which domains the run had and which waits: "내 도메인 서비스/OS, 가상화 · 담당자 설정 기본값". */
export function scopeText(scope: {
  readonly domains: readonly Domain[];
  readonly leadTimesLabel: string;
}): string {
  const mine =
    scope.domains.length > 0
      ? scope.domains.map((d) => domainInfo(d).label).join(", ")
      : "모든 도메인";
  return `내 도메인 ${mine} · 담당자 설정 ${scope.leadTimesLabel}`;
}

/** What the result says under "넘긴 일": the number of hand-offs and the points taken. */
export function handoffSummary(report: HandoffReport): string {
  const base = `${report.count}번 넘겼어요 · 고장 ${report.faults}개`;
  return report.penalty > 0
    ? `${base} · 내 도메인에서 풀 수 있는 ${report.needless}건 때문에 −${report.penalty}점`
    : base;
}
