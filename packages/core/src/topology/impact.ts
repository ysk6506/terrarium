/**
 * The impact range (REQ-078, ADR-0084): from what is broken or alarming, follow the dependencies backwards to
 * the rooms, racks and servers that lean on it, and say how many there are and how soon it turns serious.
 * This is for the screen and for scoring. It is not a tool the agent can call (ADR-0087): the agent has to
 * find the reach itself, and the board shows what it was.
 *
 * A piece of equipment is in the range when it lost at least half of what it leans on (one of two cooling
 * units, one of two PDUs): redundancy that is gone is still trouble. It is *down* when it lost all of it, and
 * then what leans on it loses it in turn.
 */
import { RACK_CRITICAL_C } from "@terrarium/core/physics";
import { type BlueprintIndex, type LinkKind, serviceDef } from "@terrarium/core/world";
import { type Causes, causesOf } from "./causes";
import { rackServers } from "./shape";
import type { TopologySource } from "./types";

/** Seconds of warming that is too slow to call a trend, °C per second. */
const FLAT = 0.0005;

const KINDS: readonly LinkKind[] = ["power", "cooling", "network", "runs_on"];

/** Faults that take the thing itself away, as opposed to making it worse. */
const TAKES_AWAY = new Set([
  "cooling_unit_failure",
  "chiller_failure",
  "cdu_failure",
  "breaker_trip",
  "switch_failure",
  "generator_start_failure",
  "utility_outage",
  "link_down",
]);

export interface Severe {
  /** Heat takes time; power does not. */
  readonly kind: "thermal" | "power";
  /** Minutes until the first rack reaches the critical temperature; 0 when it already has (or power is already gone). */
  readonly minutes: number;
  readonly celsius: number;
  /** The rack that gets there first. */
  readonly at?: string;
}

/** What the services under the range are doing (ADR-0091): how many stopped or slowed, and the work waiting. */
export interface ServiceImpact {
  readonly down: number;
  readonly degraded: number;
  /** Batch services with work waiting, the most first. */
  readonly waiting: ReadonlyArray<{
    readonly name: string;
    readonly items: number;
    readonly unit: string;
  }>;
}

export const NO_SERVICES: ServiceImpact = { down: 0, degraded: 0, waiting: [] };

export interface Impact {
  /** The services that stopped or slowed, and what piled up behind them. */
  readonly services: ServiceImpact;
  readonly causes: Causes;
  /** Equipment that leans on something lost, apart from the equipment that is itself broken or alarming. */
  readonly affected: ReadonlySet<string>;
  readonly rooms: ReadonlySet<string>;
  readonly racks: ReadonlySet<string>;
  readonly servers: number;
  readonly severe?: Severe;
}

const NONE: ReadonlySet<string> = new Set();

/** Equipment that is gone: a fault took it, or its state says it does not run. */
function startingDown(source: TopologySource, causes: Causes): Set<string> {
  const down = new Set<string>();
  const { index } = source;
  const gone = new Set(
    source
      .faults()
      .filter((f) => TAKES_AWAY.has(f.type))
      .map((f) => f.target),
  );
  for (const id of new Set([...causes.faulted, ...causes.alarmed, ...gone])) {
    if (gone.has(id) || stateSaysDown(source, id)) down.add(id);
  }
  for (const kind of [
    "chiller",
    "cooling_unit",
    "cdu",
    "pdu",
    "power_panel",
    "ups",
    "switch",
  ] as const)
    for (const e of index.ofKind(kind)) if (stateSaysDown(source, e.id)) down.add(e.id);
  return down;
}

/** Whether a state says the equipment is gone: it does not run, it has no power, its breaker fell, it would not start. */
function stateSaysDown(source: TopologySource, id: string): boolean {
  if (!source.index.has(id)) return false;
  const s = source.stateOf(id) as unknown as Record<string, unknown>;
  return s.running === false || s.powered === false || s.tripped === true || s.phase === "failed";
}

interface Spread {
  readonly down: Set<string>;
  readonly affected: Set<string>;
}

/** Whether losing every supplier of this kind takes the consumer itself away (a unit with no water, a switch with no uplink). */
function losesItself(index: BlueprintIndex, id: string, kind: LinkKind): boolean {
  const k = index.find(id)?.kind;
  if (kind === "power" || kind === "runs_on") return true;
  return k === "cooling_unit" || k === "cdu" || k === "switch";
}

/** Walk the dependencies backwards from what is down. */
function spread(source: TopologySource, start: ReadonlySet<string>): Spread {
  const { index } = source;
  const down = new Set(start);
  const affected = new Set<string>();
  const queue = [...start];
  const lostOf = new Map<string, number>();
  while (queue.length > 0) {
    const lost = queue.pop() as string;
    for (const kind of KINDS) {
      for (const l of index.incoming(lost, kind)) {
        const key = `${l.from}|${kind}`;
        const n = (lostOf.get(key) ?? 0) + 1;
        lostOf.set(key, n);
        const total = index.outgoing(l.from, kind).length;
        if (n * 2 >= total) affected.add(l.from);
        if (n >= total && !down.has(l.from) && losesItself(index, l.from, kind)) {
          down.add(l.from);
          queue.push(l.from);
        }
      }
    }
  }
  return { down, affected };
}

interface Reach {
  readonly rooms: Set<string>;
  readonly racks: Set<string>;
  readonly servers: number;
}

/** Sort the equipment in trouble into racks (whole), servers (alone) and rooms. */
function sorted(index: BlueprintIndex, ids: ReadonlySet<string>) {
  const whole = new Set<string>();
  const loose = new Set<string>();
  const rooms = new Set<string>();
  for (const id of ids) {
    const kind = index.find(id)?.kind;
    if (kind === "rack") whole.add(id);
    else if (kind === "server") loose.add(id);
    else if (kind === "room") rooms.add(id);
  }
  return { whole, loose, rooms };
}

/** The rooms, racks and servers that are in trouble: a rack takes all of its servers with it, a server only itself. */
function reachOf(source: TopologySource, ids: ReadonlySet<string>): Reach {
  const { index } = source;
  const { whole, loose, rooms } = sorted(index, ids);
  const racks = new Set(whole);
  let servers = 0;
  for (const id of whole) servers += rackServers(index, index.entity(id));
  for (const id of loose) {
    const rack = index.find(id)?.parentId;
    if (rack && index.find(rack)?.kind === "rack") racks.add(rack);
    if (!rack || !whole.has(rack)) servers++;
  }
  for (const id of racks) {
    const room = index.enclosing(id, "room");
    if (room) rooms.add(room.id);
  }
  return { rooms, racks, servers };
}

/** When the first rack in the range gets to the critical temperature if it keeps warming as it is. */
function thermal(source: TopologySource, racks: ReadonlySet<string>): Severe | undefined {
  const earlier = source.earlier;
  const dt = earlier ? source.time() - earlier.t : 0;
  let first: Severe | undefined;
  for (const id of racks) {
    const s = source.stateOf(id);
    if (s.kind !== "rack") continue;
    const before = earlier?.inletC.get(id);
    const rate = before !== undefined && dt > 0 ? (s.inletC - before) / dt : 0;
    const minutes =
      s.inletC >= RACK_CRITICAL_C
        ? 0
        : rate > FLAT
          ? Math.ceil((RACK_CRITICAL_C - s.inletC) / rate / 60)
          : undefined;
    if (minutes !== undefined && (!first || minutes < first.minutes))
      first = { kind: "thermal", minutes, celsius: RACK_CRITICAL_C, at: id };
  }
  return first;
}

function severity(
  source: TopologySource,
  reach: Reach,
  down: ReadonlySet<string>,
): Severe | undefined {
  const hot = thermal(source, reach.racks);
  const { index } = source;
  const dark = [...down].some((id) => {
    const k = index.find(id)?.kind;
    return k === "pdu" || k === "power_panel" || k === "ups";
  });
  if (hot && hot.minutes === 0) return hot;
  if (dark) return { kind: "power", minutes: 0, celsius: RACK_CRITICAL_C };
  return hot;
}

/** Read the services off their state: the equipment below has already told them how to be. */
export function servicesOf(source: TopologySource): ServiceImpact {
  let down = 0;
  let degraded = 0;
  const waiting: Array<ServiceImpact["waiting"][number]> = [];
  for (const e of source.index.ofKind("service")) {
    const s = source.stateOf(e.id);
    if (s.kind !== "service") continue;
    if (s.status === "down") down++;
    else if (s.status === "degraded") degraded++;
    const queue = serviceDef(e).queue;
    if (queue && s.backlog > 0) waiting.push({ name: e.name, items: s.backlog, unit: queue.unit });
  }
  return { down, degraded, waiting: waiting.sort((a, b) => b.items - a.items) };
}

/** The range of what is broken or alarming right now. */
export function impactOf(source: TopologySource): Impact {
  const causes = causesOf(source);
  const start = startingDown(source, causes);
  const { down, affected } = spread(source, start);
  const reaching = new Set([...causes.faulted, ...causes.alarmed, ...affected, ...down]);
  const reach = reachOf(source, reaching);
  const severe = severity(source, reach, down);
  const coloured = colouredBy(source, affected, reach, causes);
  return {
    causes,
    affected: coloured,
    ...reach,
    services: servicesOf(source),
    ...(severe ? { severe } : {}),
  };
}

/** What the board paints grey: the dependents, the servers inside a dependent rack and the rooms they stand in. */
function colouredBy(
  source: TopologySource,
  affected: ReadonlySet<string>,
  reach: Reach,
  causes: Causes,
): Set<string> {
  const { index } = source;
  const grey = new Set(affected);
  for (const rack of reach.racks)
    if (affected.has(rack)) for (const s of index.childrenOf(rack, "server")) grey.add(s.id);
  for (const room of reach.rooms) grey.add(room);
  for (const id of [...grey]) if (causes.faulted.has(id) || causes.alarmed.has(id)) grey.delete(id);
  return grey;
}

export const NO_IMPACT: Impact = {
  causes: { faulted: NONE, alarmed: NONE },
  affected: NONE,
  rooms: NONE,
  racks: NONE,
  servers: 0,
  services: NO_SERVICES,
};
