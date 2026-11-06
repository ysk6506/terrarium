/**
 * Replay (REQ-078 step 2, ADR-0084 item 8): the topology of a run at any moment, rebuilt from the run's events
 * (ADR-0088 item 1) and nothing else. `stateAt(events, t)` folds the events up to `t` into what the board needs:
 * which faults and alarms are alive, which switches were flipped, which links are cut, what the agent touched last.
 * `replaySource` lays that over the world as it was built, so `fold` and `impactOf` read it like any other source.
 *
 * What a replay knows is what the events say. Temperatures and loads come from physics, which is not in the
 * record, so a replayed board shows them as the world was built (see topology.md, limits).
 */
import type { Catalog } from "@terrarium/core/catalog";
import {
  type Alarm,
  type BlueprintIndex,
  type EntityState,
  type Fault,
  initialState,
  type RunEvent,
  type ToolEvent,
  type WorldCommand,
} from "@terrarium/core/world";
import type { TopologySource } from "./types";

/** The board's reading of a run at one moment. */
export interface ReplayState {
  readonly t: number;
  readonly faults: readonly Fault[];
  readonly alarms: readonly Alarm[];
  /** Cables a fault has cut. */
  readonly linksDown: ReadonlySet<string>;
  /** What the events changed on single pieces of equipment, by id; merged over the world as built. */
  readonly patches: ReadonlyMap<string, Readonly<Record<string, unknown>>>;
  /** The last call that named equipment, if any call has been made by `t`. */
  readonly last?: ToolEvent;
  /** The equipment that call named: "where the agent is touching", kept until the next call. */
  readonly touched: ReadonlySet<string>;
  /** Tool calls made by `t`. */
  readonly calls: number;
  /** The run was closed by `t`. */
  readonly closed: boolean;
}

interface Acc {
  faults: Map<string, Fault>;
  alarms: Map<string, Alarm>;
  links: Set<string>;
  patches: Map<string, Record<string, unknown>>;
  last?: ToolEvent;
  calls: number;
  closed: boolean;
}

function patch(acc: Acc, id: string, change: Record<string, unknown>): void {
  acc.patches.set(id, { ...acc.patches.get(id), ...change });
}

/** What happens the moment a fault starts or ends (the ones the world applies at once; the rest is physics). */
function immediate(acc: Acc, fault: Fault, active: boolean): void {
  if (fault.type === "breaker_trip") patch(acc, fault.target, { tripped: active });
  if (fault.type === "grid_outage") patch(acc, fault.target, { inputOk: !active });
  if (fault.type === "link_down") {
    if (active) acc.links.add(fault.target);
    else acc.links.delete(fault.target);
  }
}

/** Faults and the breaker that clears one. */
function applyFault(acc: Acc, c: WorldCommand, t: number): void {
  if (c.type === "fault.add") {
    const fault: Fault = { ...c.fault, since: t };
    acc.faults.set(fault.id, fault);
    immediate(acc, fault, true);
  } else if (c.type === "fault.remove") {
    const fault = acc.faults.get(c.faultId);
    acc.faults.delete(c.faultId);
    if (fault) immediate(acc, fault, false);
  } else if (c.type === "breaker.reset") {
    for (const f of [...acc.faults.values()])
      if (f.target === c.target && f.type === "breaker_trip") acc.faults.delete(f.id);
    patch(acc, c.target, { tripped: false });
  }
}

function applyCommand(acc: Acc, c: WorldCommand, t: number): void {
  switch (c.type) {
    case "alarm.raise":
      acc.alarms.set(c.alarm.id, c.alarm);
      return;
    case "alarm.clear":
      acc.alarms.delete(c.alarmId);
      return;
    case "power.set":
      patch(acc, c.target, { adminOn: c.on });
      return;
    case "thermal.shutdown":
      patch(acc, c.target, { adminOn: false, health: "critical" });
      return;
    case "setpoint.set":
      patch(acc, c.target, { setpointC: c.celsius });
      return;
    default:
      applyFault(acc, c, t);
  }
}

/** The index of the first event after `t` (events are in time order). */
function upTo(events: readonly RunEvent[], t: number): number {
  let lo = 0;
  let hi = events.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((events[mid] as RunEvent).t <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** How many events have happened by `t`. */
export const countAt = (events: readonly RunEvent[], t: number): number => upTo(events, t);

/**
 * The board's state at `t`. A pure fold of the events at or before `t`, which is cheap enough to run on every
 * frame of a drag: ten thousand events take a few milliseconds, so there are no checkpoints to keep.
 */
export function stateAt(events: readonly RunEvent[], t: number): ReplayState {
  const acc: Acc = {
    faults: new Map(),
    alarms: new Map(),
    links: new Set(),
    patches: new Map(),
    calls: 0,
    closed: false,
  };
  const end = upTo(events, t);
  for (let i = 0; i < end; i++) {
    const e = events[i] as RunEvent;
    if (e.kind === "world") applyCommand(acc, e.command, e.t);
    else if (e.kind === "tool") {
      acc.calls++;
      if (e.targets.length > 0) acc.last = e;
    } else if (e.what === "closed") acc.closed = true;
  }
  return {
    t,
    faults: [...acc.faults.values()],
    alarms: [...acc.alarms.values()],
    linksDown: acc.links,
    patches: acc.patches,
    touched: new Set(acc.last?.targets ?? []),
    calls: acc.calls,
    closed: acc.closed,
    ...(acc.last ? { last: acc.last } : {}),
  };
}

const resting = new WeakMap<BlueprintIndex, TopologySource>();

/** The world as it was built, before anything ran: no faults, no alarms, every link up. */
export function restingSource(index: BlueprintIndex, catalog: Catalog): TopologySource {
  const known = resting.get(index);
  if (known) return known;
  const { entities } = initialState(index, catalog);
  const source: TopologySource = {
    index,
    time: () => 0,
    stateOf: (id) => entities[id] as EntityState,
    faults: () => [],
    alarms: () => [],
    linkUp: () => true,
  };
  resting.set(index, source);
  return source;
}

/** The source of a moment of a run: the world as built, with what the events did to it laid over. */
export function replaySource(base: TopologySource, state: ReplayState): TopologySource {
  const { index } = base;
  return {
    index,
    time: () => state.t,
    stateOf: (id) => {
      const p = state.patches.get(id);
      const s = base.stateOf(id);
      return p ? ({ ...s, ...p } as EntityState) : s;
    },
    faults: () => state.faults,
    alarms: () => state.alarms,
    linkUp: (id) => !state.linksDown.has(id),
    touched: state.touched,
  };
}
