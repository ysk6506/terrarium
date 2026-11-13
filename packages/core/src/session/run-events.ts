/**
 * The run's record, written as it happens (REQ-083, ADR-0088 item 1): tool calls, world events and the run's own
 * milestones in one append-only list. A session owns one `RunLog`; the host can read what is new after every
 * call (the live topology view) and the finished run carries the whole list.
 */
import { CLUSTER_CAUSE } from "@terrarium/core/physics";
import { ACTION_LABELS, type ToolCallRecord } from "@terrarium/core/scenario";
import { callEffect, callTargets } from "@terrarium/core/tools";
import type {
  GapEvent,
  HumanEvent,
  RunEvent,
  ToolEvent,
  World,
  WorldCommand,
  WorldEvent,
} from "@terrarium/core/world";
import type { CounterpartDraft } from "./counterparts";
import type { TicketDraft } from "./tickets";

/** A person's event as it is written: the log numbers it. */
type HumanInput = HumanEvent extends infer E ? (E extends unknown ? Omit<E, "seq"> : never) : never;

/** What came of a call in a few words: why it failed, or what it changed (names, not ids, when given). */
function summaryOf(call: ToolCallRecord, nameOf: (id: string) => string): string {
  if (!call.ok) return call.error ?? "실패했어요";
  return (call.effects ?? [])
    .map((e) => `${nameOf(e.target)} ${ACTION_LABELS[e.action]}`)
    .join(", ");
}

export class RunLog {
  private readonly list: RunEvent[] = [];
  /** The last world event already written. */
  private cursor = 0;

  constructor(
    private readonly world: World,
    private readonly nameOf: (id: string) => string = (id) => id,
  ) {}

  /** Everything written so far. */
  get events(): readonly RunEvent[] {
    return this.list;
  }

  /** What was written after the first `count` events (the host asks for what is new). */
  since(count: number): readonly RunEvent[] {
    return this.list.slice(count);
  }

  /** What the other side and the tickets wrote since the last flush; it joins the world's events in time order. */
  private waiting: RunEvent[] = [];

  private worldEvents(): RunEvent[] {
    const fresh = this.world
      .events(this.cursor)
      .filter((e) => e.type !== "note" || e.cause === CLUSTER_CAUSE);
    this.cursor = this.world.lastSeq();
    const events = fresh.map((e) => this.fromWorld(e));
    if (this.waiting.length === 0) return events;
    // a stable sort keeps the world's event first when both happened at the same moment
    const merged = [...events, ...this.waiting].sort((a, b) => a.t - b.t);
    this.waiting = [];
    return merged;
  }

  private fromWorld(e: WorldEvent): RunEvent {
    const { seq: _seq, t, cause, ...command } = e;
    return { kind: "world", seq: 0, t, cause, command: command as WorldCommand };
  }

  private add(events: readonly RunEvent[]): void {
    for (const e of events) this.list.push({ ...e, seq: this.list.length });
  }

  /** The agent has its task. */
  agentStart(t: number, scenarioStart: number): void {
    this.add([
      ...this.worldEvents(),
      { kind: "score", what: "agent_start", seq: 0, t, scenarioStart },
    ]);
  }

  /** A tool call: the world events that came before it in time, the call, then what it and the step after it caused. */
  call(call: ToolCallRecord): void {
    const fresh = this.worldEvents();
    const before = fresh.filter((e) => e.t < call.t);
    const after = fresh.filter((e) => e.t >= call.t);
    const event: ToolEvent = {
      kind: "tool",
      seq: 0,
      t: call.t,
      tool: call.tool,
      args: call.args,
      ok: call.ok,
      ...(call.error ? { error: call.error } : {}),
      effect: callEffect(call.tool, call.args),
      targets: callTargets(call.tool, call.args),
      summary: summaryOf(call, this.nameOf),
      ...(call.blocked ? { blockedBy: call.blocked } : {}),
    };
    const at = this.list.length + before.length;
    const gaps: GapEvent[] = (call.gaps ?? []).map((g) => ({
      kind: "gap",
      seq: 0,
      t: call.t,
      tool: g.tool,
      feature: g.feature,
      call: at,
    }));
    this.add([...before, event, ...gaps, ...after]);
  }

  /** The agent asked a person, a person did something for it, or the question was answered (ADR-0087 item 4). */
  human(event: HumanInput): void {
    this.add([...this.worldEvents(), { ...event, seq: 0 } as RunEvent]);
  }

  /** The other side of a hand-off did something (REQ-093): the world events up to it come first. */
  counterpart(e: CounterpartDraft): void {
    this.waiting.push({ ...e, seq: 0 } as RunEvent);
  }

  /** A work ticket was made or changed. */
  ticket(e: TicketDraft): void {
    this.waiting.push({ ...e, seq: 0 });
  }

  /** World events that happened with no call to carry them (time passing on its own). */
  flush(): void {
    this.add(this.worldEvents());
  }

  /** The run is over and scored. */
  close(e: {
    readonly closedAt: number;
    readonly gradedAt: number;
    readonly reason: string;
    readonly diagnosed: boolean;
    readonly total: number | null;
    readonly passed: boolean;
    readonly rootCause: readonly string[];
  }): void {
    this.add([
      ...this.worldEvents(),
      {
        kind: "score",
        what: "closed",
        seq: 0,
        t: e.closedAt,
        reason: e.reason,
        diagnosed: e.diagnosed,
      },
      {
        kind: "score",
        what: "graded",
        seq: 0,
        t: e.gradedAt,
        total: e.total,
        passed: e.passed,
        rootCause: e.rootCause,
      },
    ]);
  }
}

/** A tool call the host saw, with the wall-clock time it saw it at. */
export interface CallStamp {
  readonly t: number;
  readonly tool: string;
  readonly real: string;
}

/**
 * Put the wall clock on a finished run's events. A tool call gets the time of the matching call the host saw
 * (the host also saw calls the session refused after the run ended, which are skipped); any other event gets the
 * time of the last call before it, or `startedAt` before the first one. Returns new events; the input is not changed.
 */
export function stampReal(
  events: readonly RunEvent[],
  calls: readonly CallStamp[],
  startedAt: string | undefined,
): RunEvent[] {
  let next = 0;
  let last = startedAt;
  return events.map((e) => {
    if (e.kind === "tool") {
      const at = calls.findIndex((c, i) => i >= next && c.t === e.t && c.tool === e.tool);
      if (at >= 0) {
        next = at + 1;
        last = (calls[at] as CallStamp).real;
      }
    }
    return last ? { ...e, real: last } : e;
  });
}

/** What a run saved before the record existed still has: its tool calls and how it ended (no world events). */
export function legacyEvents(run: {
  readonly toolCalls: readonly ToolCallRecord[];
  readonly endReason: string;
  readonly diagnosis?: unknown;
  readonly score: { readonly total: number | null; readonly passed: boolean };
  readonly simTime: {
    readonly scenarioStart: number;
    readonly agentStart: number;
    readonly end: number;
  };
}): RunEvent[] {
  const { simTime } = run;
  const calls = run.toolCalls.map(
    (c): RunEvent => ({
      kind: "tool",
      seq: 0,
      t: c.t,
      tool: c.tool,
      args: c.args,
      ok: c.ok,
      ...(c.error ? { error: c.error } : {}),
      effect: callEffect(c.tool, c.args),
      targets: callTargets(c.tool, c.args),
      summary: c.ok ? "" : (c.error ?? "실패했어요"),
    }),
  );
  const log: RunEvent[] = [
    {
      kind: "score",
      what: "agent_start",
      seq: 0,
      t: simTime.agentStart,
      scenarioStart: simTime.scenarioStart,
    },
    ...calls,
    {
      kind: "score",
      what: "closed",
      seq: 0,
      t: simTime.end,
      reason: run.endReason,
      diagnosed: run.diagnosis !== undefined,
    },
    {
      kind: "score",
      what: "graded",
      seq: 0,
      t: simTime.end,
      total: run.score.total,
      passed: run.score.passed,
      rootCause: [],
    },
  ];
  return log.map((e, i) => ({ ...e, seq: i }));
}
