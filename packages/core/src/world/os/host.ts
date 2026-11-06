/**
 * What the fake shell knows about one host while it answers (ADR-0117): the host's operating-system state, the
 * services on it, and the faults that have been on it, including ended ones (the journal remembers them). It is
 * made fresh for every command, so a command that changes the world is seen by the next.
 */
import type { ServerModel } from "@terrarium/core/catalog";
import type { Fault, FaultType } from "../faults";
import { hostOsOf, servicesOnHost } from "../host-os";
import { netModelOf } from "../net-model";
import type { HostOs } from "../os";
import { serviceDef } from "../service";
import type { WorldReader } from "../world";
import { spread } from "./layout";

/** A fault on a host from the moment it began to the moment it ended (undefined while it lasts). */
export interface FaultSpan {
  readonly id: string;
  readonly type: FaultType;
  readonly params: Readonly<Record<string, number>>;
  readonly since: number;
  readonly until?: number;
}

export interface OsService {
  readonly id: string;
  readonly name: string;
  readonly process: string;
  readonly status: string;
}

export interface OsHost {
  readonly world: WorldReader;
  readonly id: string;
  readonly name: string;
  readonly kind: "server" | "vm";
  readonly ip: string;
  readonly os: HostOs;
  /** World time, seconds. */
  readonly t: number;
  /** World time the system last booted. */
  readonly bootT: number;
  readonly memTotalMb: number;
  readonly cores: number;
  readonly services: readonly OsService[];
  readonly spans: readonly FaultSpan[];
  /** Whether a database instance runs here. */
  readonly db: boolean;
}

interface SpanCache {
  seq: number;
  byTarget: Map<string, FaultSpan[]>;
}
const CACHE = new WeakMap<WorldReader, SpanCache>();

function spansByTarget(world: WorldReader): Map<string, FaultSpan[]> {
  const seq = world.lastSeq();
  const hit = CACHE.get(world);
  if (hit && hit.seq === seq) return hit.byTarget;
  const byTarget = new Map<string, FaultSpan[]>();
  const open = new Map<string, { -readonly [K in keyof FaultSpan]: FaultSpan[K] }>();
  for (const e of world.events()) {
    if (e.type === "fault.add") {
      const f = e.fault;
      const span = { id: f.id, type: f.type, params: f.params, since: e.t };
      open.set(f.id, span);
      byTarget.set(f.target, [...(byTarget.get(f.target) ?? []), span]);
    } else if (e.type === "fault.remove") {
      const span = open.get(e.faultId);
      if (span) span.until = e.t;
      open.delete(e.faultId);
    }
  }
  CACHE.set(world, { seq, byTarget });
  return byTarget;
}

/**
 * The spans of a host, plus faults that are active but began before the event log (a world restored from a
 * snapshot). A fault that an operator's action ended (a restart, a remount) leaves no `fault.remove` event, so
 * a span that is still open while its fault is gone ended at the first action on the host after it began.
 */
function spansOf(world: WorldReader, id: string, active: readonly Fault[]): FaultSpan[] {
  const known = spansByTarget(world).get(id) ?? [];
  const gone = (s: FaultSpan): boolean =>
    s.until === undefined && !active.some((f) => f.id === s.id);
  // the host's actions are read only when some span ended without a `fault.remove`
  const acts = known.some(gone)
    ? world.events().filter((e) => e.type === "host.act" && e.target === id)
    : [];
  const settled = known.map((s) =>
    gone(s) ? { ...s, until: acts.find((e) => e.t >= s.since)?.t ?? world.time() } : s,
  );
  const missing = active
    .filter((f) => !known.some((s) => s.id === f.id))
    .map((f) => ({ id: f.id, type: f.type, params: f.params, since: f.since }));
  return [...settled, ...missing].sort((a, b) => a.since - b.since);
}

function memoryMb(world: WorldReader, id: string): number {
  const e = world.index.entity(id);
  if (e.kind === "vm") return Number(e.props.memoryGiB ?? 16) * 1024;
  try {
    return (world.catalog.getOf(e.modelId ?? "", "server") as ServerModel).memoryGiB * 1024;
  } catch {
    return 262_144;
  }
}

function coresOf(world: WorldReader, id: string): number {
  const e = world.index.entity(id);
  if (e.kind === "vm") return Number(e.props.cpuCount ?? 4);
  try {
    const m = world.catalog.getOf(e.modelId ?? "", "server") as ServerModel;
    return m.cpuSockets * m.coresPerSocket;
  } catch {
    return 32;
  }
}

/** The address of a host: the network plan's for a server that has one, else one made from its id. */
export function ipOf(world: WorldReader, id: string): string {
  const plan =
    world.index.find(id)?.kind === "server" ? netModelOf(world).plan.hosts.get(id) : undefined;
  if (plan) return plan.ip;
  const h = Math.round(spread(id, "ip", 0, 9973));
  return `10.20.${h % 200}.${((h >> 3) % 250) + 2}`;
}

/** Gather what the shell needs to answer on host `id` (a server or a VM). */
export function osHostOf(world: WorldReader, id: string): OsHost {
  const entity = world.index.entity(id);
  const os = hostOsOf(world, id);
  const t = world.time();
  const services = servicesOnHost(world, id).map((s) => ({
    id: s.id,
    name: s.name,
    process: serviceDef(s).process,
    status: world.stateAs(s.id, "service").status,
  }));
  const hasDb = world.index
    .incoming(id, "hosted_on")
    .some((l) => world.index.find(l.from)?.kind === "db_instance");
  return {
    world,
    id,
    name: entity.name,
    kind: entity.kind === "vm" ? "vm" : "server",
    ip: ipOf(world, id),
    os,
    t,
    bootT: t - os.uptimeS,
    memTotalMb: memoryMb(world, id),
    cores: coresOf(world, id),
    services,
    spans: spansOf(world, id, world.faultsOn(id)),
    db: hasDb,
  };
}

/** The span of a fault type that is still on, if there is one. */
export const activeSpan = (h: OsHost, type: FaultType): FaultSpan | undefined =>
  h.spans.find((s) => s.type === type && s.until === undefined);

/** Whether a fault of this type was on at time `t`. */
export const spanAt = (h: OsHost, type: FaultType, t: number): FaultSpan | undefined =>
  h.spans.find((s) => s.type === type && s.since <= t && (s.until === undefined || t <= s.until));

/** The process that does the work of the services here (the one the faults pick on). */
export function culpritName(h: OsHost): string {
  return (
    h.os.processes.find((p) => p.user === "svc")?.name ??
    h.os.processes.find((p) => p.name === "rsyslogd")?.name ??
    "app"
  );
}
