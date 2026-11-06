/**
 * What a run did with the work it handed to other teams, read from the run's events alone (REQ-093, ADR-0098 item 4,
 * ADR-0099 item 3, ADR-0100). Tickets or no tickets, the record says the same. Four questions about each hand-off:
 *
 *   bridge    did the agent save the services with its own tools while the team worked? (the recovery time of the
 *             recovery-first score already carries the cost of waiting; this says whether it was waiting or acting)
 *   cleanup   when the team was done, did it undo the temporary measure (put the VM back)? and how late?
 *   meanwhile did it look after the other alarms that came up during the wait?
 *   reason    was the fault one its own tools could fix? handing that over costs points; the others are what the
 *             hand-off is for
 *
 * A pure function of the events and the world's blueprint, so scoring a finished run and replaying it give the same.
 */
import { FAULT_RESPONSES } from "@terrarium/core/scenario";
import {
  type BlueprintIndex,
  type CounterpartEvent,
  type Domain,
  type FaultType,
  faultDomain,
  type HandedFault,
  impairedAt,
  type RunEvent,
  serviceTimeline,
  type ToolEvent,
} from "@terrarium/core/world";

/** Points taken for each fault handed over that the agent's own domain could have fixed, at most three times. */
export const NEEDLESS_PENALTY = 5;
export const NEEDLESS_CAP = 3;

export interface HandoffFault {
  readonly faultId: string;
  readonly faultType: string;
  readonly target: string;
  readonly etaSeconds: number;
  readonly doneAt: number;
  /** Whether it was gone by the end of the run. */
  readonly finished: boolean;
  /** Whether the agent's own tools could have fixed it. */
  readonly needless: boolean;
}

export interface HandoffRow {
  readonly id: string;
  readonly domain: Domain;
  readonly team: string;
  readonly at: number;
  readonly note?: string;
  readonly faults: readonly HandoffFault[];
  /** When the last of its faults is gone (undefined for a hand-off with no fault). */
  readonly doneAt?: number;
  readonly bridge: {
    /** Services that were stopped or slow when it was handed over. */
    readonly impaired: number;
    /** Whether the agent changed something while it waited. */
    readonly acted: boolean;
    /** Seconds from the hand-off to the moment the services were all well, if that came before the team was done. */
    readonly savedAfterSeconds?: number;
  };
  readonly cleanup: {
    /** Moves the agent made during the wait that it should put back. */
    readonly needed: number;
    readonly done: number;
    /** Seconds after the team finished that the last one was put back; undefined when none was. */
    readonly lateSeconds?: number;
  };
  readonly meanwhile: { readonly alarms: number; readonly looked: number; readonly calls: number };
}

export interface HandoffReport {
  /** How many times the agent handed work over. */
  readonly count: number;
  /** Faults in those hand-offs. */
  readonly faults: number;
  /** Faults the agent's own tools could have fixed (and hand-offs with nothing in them). */
  readonly needless: number;
  readonly penalty: number;
  readonly rows: readonly HandoffRow[];
}

const isAct = (e: RunEvent): e is ToolEvent => e.kind === "tool" && e.effect === "act" && e.ok;
const toolEvents = (events: readonly RunEvent[]): ToolEvent[] =>
  events.filter((e): e is ToolEvent => e.kind === "tool");

type Handed = Extract<CounterpartEvent, { what: "handed" }>;
const handedEvents = (events: readonly RunEvent[]): Handed[] =>
  events.filter((e): e is Handed => e.kind === "counterpart" && e.what === "handed");

const doneIds = (events: readonly RunEvent[]): Set<string> =>
  new Set(
    events.flatMap((e) => (e.kind === "counterpart" && e.what === "done" ? [e.fault.faultId] : [])),
  );

const needlessFault = (f: HandedFault, mine: readonly Domain[]): boolean =>
  mine.includes(faultDomain(f.faultType as FaultType)) &&
  FAULT_RESPONSES[f.faultType as FaultType]?.remedy === "fix";

/** The server a VM or service sits on at the start, by the blueprint. */
function homeServer(
  index: Pick<BlueprintIndex, "find" | "outgoing">,
  id: string,
): string | undefined {
  const kind = index.find(id)?.kind;
  if (kind === "server") return id;
  if (kind === "vm") return index.outgoing(id, "runs_on")[0]?.to;
  if (kind === "service") {
    const active = index.outgoing(id, "service_on").find((l) => l.props.role === "active");
    return active ? homeServer(index, active.to) : undefined;
  }
  return undefined;
}

interface Move {
  readonly t: number;
  readonly what: "vm" | "service";
  readonly id: string;
  /** Where a VM went (a server). */
  readonly to?: string;
}

const movesOf = (calls: readonly ToolEvent[]): Move[] =>
  calls.filter(isAct).flatMap((c): Move[] => {
    if (c.tool === "migrate_vm")
      return [{ t: c.t, what: "vm", id: String(c.args.vm ?? ""), to: String(c.args.host ?? "") }];
    if (c.tool === "failover_service")
      return [{ t: c.t, what: "service", id: String(c.args.service ?? "") }];
    return [];
  });

/** The stretch a hand-off is read over: from the agent having the task to the team being done, and what it is about. */
interface Span {
  readonly since: number;
  readonly at: number;
  readonly doneAt: number;
  readonly targets: ReadonlySet<string>;
}

/**
 * What the agent moved from the equipment that was handed over, between having the task and the team being done
 * (it may have moved before handing over), and whether it put it back after.
 */
function cleanupOf(
  index: Pick<BlueprintIndex, "find" | "outgoing">,
  moves: readonly Move[],
  row: Span,
): HandoffRow["cleanup"] {
  const during = moves.filter(
    (m) => m.t >= row.since && m.t <= row.doneAt && row.targets.has(homeServer(index, m.id) ?? ""),
  );
  const back = (m: Move) =>
    moves.find(
      (b) =>
        b.t >= row.doneAt &&
        b.what === m.what &&
        b.id === m.id &&
        (m.what === "service" || b.to === homeServer(index, m.id)),
    );
  const restored = during.flatMap((m) => {
    const b = back(m);
    return b ? [b.t] : [];
  });
  return {
    needed: during.length,
    done: restored.length,
    ...(restored.length > 0
      ? { lateSeconds: Math.max(0, Math.max(...restored) - row.doneAt) }
      : {}),
  };
}

/** The alarms raised during the wait that are not the handed-over fault itself, and how many the agent looked at. */
function meanwhileOf(events: readonly RunEvent[], row: Span): HandoffRow["meanwhile"] {
  const raised = events.flatMap((e) =>
    e.kind === "world" &&
    e.command.type === "alarm.raise" &&
    e.t > row.at &&
    e.t <= row.doneAt &&
    !row.targets.has(e.command.alarm.entityId)
      ? [{ entity: e.command.alarm.entityId, t: e.t, seq: e.seq }]
      : [],
  );
  const calls = toolEvents(events).filter(
    (c) => c.t > row.at && c.t <= row.doneAt && c.tool !== "wait" && c.tool !== "events_since",
  );
  const looked = raised.filter((a) =>
    calls.some((c) => c.seq > a.seq && c.targets.includes(a.entity)),
  );
  return { alarms: raised.length, looked: looked.length, calls: calls.length };
}

/**
 * Did the agent save the services with its own tools before the team was done? It may have done so before handing
 * over, so this reads from the moment it had the task: what was in trouble then or at the hand-off, whether it changed
 * something, and when everything was well again, counted from having the task.
 */
function bridgeOf(
  events: readonly RunEvent[],
  timeline: ReturnType<typeof serviceTimeline>,
  row: Span,
): HandoffRow["bridge"] {
  const impaired = Math.max(
    impairedAt(timeline, row.since).count,
    impairedAt(timeline, row.at).count,
  );
  const acted = events.some(
    (e) => isAct(e) && e.t >= row.since && e.t <= row.doneAt && e.tool !== "escalate",
  );
  const savedAt =
    impaired > 0 && acted ? firstWellAfter(timeline, row.since, row.doneAt - 1) : undefined;
  return {
    impaired,
    acted,
    ...(savedAt === undefined ? {} : { savedAfterSeconds: Math.max(0, savedAt - row.since) }),
  };
}

/** The first change at or after `from` and before `until` after which no service is in trouble. */
function firstWellAfter(
  timeline: ReturnType<typeof serviceTimeline>,
  from: number,
  until: number,
): number | undefined {
  const times = [...new Set([...timeline.values()].flatMap((list) => list.map((c) => c.t)))]
    .filter((t) => t >= from && t <= until)
    .sort((a, b) => a - b);
  return times.find((t) => impairedAt(timeline, t).count === 0);
}

export interface HandoffInput {
  readonly events: readonly RunEvent[];
  readonly index: Pick<BlueprintIndex, "find" | "outgoing" | "allLinks">;
  /** The domains the experiment is responsible for; empty means it did not say, and nothing counts as needless. */
  readonly domains: readonly Domain[];
  /** The world time the run is read up to, for a hand-off that is not finished. */
  readonly endAt: number;
}

/** The equipment a hand-off is about: what the faults sit on, and both ends of a cable that is down. */
function touched(
  index: Pick<BlueprintIndex, "find" | "allLinks">,
  targets: readonly string[],
): Set<string> {
  const out = new Set<string>();
  for (const t of targets) {
    if (index.find(t)) out.add(t);
    else
      for (const l of index.allLinks())
        if (l.id === t) {
          out.add(l.from);
          out.add(l.to);
        }
  }
  return out;
}

export function analyzeHandoffs(input: HandoffInput): HandoffReport {
  const { events, index, domains, endAt } = input;
  const done = doneIds(events);
  const timeline = serviceTimeline(events);
  const moves = movesOf(toolEvents(events));
  const agentStart = events.find((e) => e.kind === "score" && e.what === "agent_start")?.t ?? 0;
  const rows = handedEvents(events).map((h): HandoffRow => {
    const faults = h.faults.map(
      (f): HandoffFault => ({
        faultId: f.faultId,
        faultType: f.faultType,
        target: f.target,
        etaSeconds: f.etaSeconds,
        doneAt: f.doneAt,
        finished: done.has(f.faultId),
        needless: needlessFault(f, domains),
      }),
    );
    const doneAt = faults.length > 0 ? Math.max(...faults.map((f) => f.doneAt)) : undefined;
    const until = Math.min(doneAt ?? h.t, endAt);
    const span: Span = {
      since: agentStart,
      at: h.t,
      doneAt: until,
      targets: touched(
        index,
        faults.map((f) => f.target),
      ),
    };
    return {
      id: h.handoff,
      domain: h.domain,
      team: h.team,
      at: h.t,
      ...(h.note ? { note: h.note } : {}),
      faults,
      ...(doneAt === undefined ? {} : { doneAt }),
      bridge: bridgeOf(events, timeline, span),
      cleanup: cleanupOf(index, moves, span),
      meanwhile: meanwhileOf(events, span),
    };
  });
  const needless = rows.reduce(
    (sum, r) => sum + (r.faults.length === 0 ? 1 : r.faults.filter((f) => f.needless).length),
    0,
  );
  return {
    count: rows.length,
    faults: rows.reduce((sum, r) => sum + r.faults.length, 0),
    needless,
    penalty: Math.min(needless, NEEDLESS_CAP) * NEEDLESS_PENALTY,
    rows,
  };
}
