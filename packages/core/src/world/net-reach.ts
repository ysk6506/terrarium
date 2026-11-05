/**
 * Which servers the network has cut off by a configuration change (REQ-064, ADR-0061). Monitoring pings every
 * server from the top of the network above it. A server is *cut off by configuration* when that ping works
 * with the switches as designed and fails with them as configured: a port in the wrong VLAN, a trunk that
 * lost a VLAN, an SVI shut down, a route deleted. Servers that are unreachable because a cable is down or a
 * switch has no power are not counted here (the link and power alarms already name those).
 */

import { ipToInt } from "./net-addr";
import type { NetModel } from "./net-model";
import { netModelOf } from "./net-model";
import type { HostPlan } from "./net-topology";
import { type Failure, type PingResult, ping } from "./net-trace";
import type { WorldReader } from "./world";

export interface ReachProblem {
  /** Whether the request never arrived or the reply never came back. */
  readonly stage: "request" | "reply";
  readonly failure: Failure;
  /** The switch or server where it stopped. */
  readonly at: string;
}

export interface CutOff {
  readonly host: HostPlan;
  readonly problem: ReachProblem;
}

/** Whether a server is on (it has power and nobody switched it off). */
export function hostIsUp(world: WorldReader, host: HostPlan): boolean {
  const state = world.stateOf(host.id);
  if (!("powered" in state)) return true;
  return state.powered && (!("adminOn" in state) || state.adminOn);
}

const anyHost = (): boolean => true;

/** The first alive switch at the top of the network above a leaf, which pings from. */
export function anchorOf(model: NetModel, leaf: string): string | undefined {
  return (model.plan.tops.get(leaf) ?? []).find((sw) => model.isAlive(sw));
}

export function problemOf(result: PingResult): ReachProblem | undefined {
  if (result.ok) return undefined;
  const stage = result.forward.delivered ? "reply" : "request";
  const trace = result.forward.delivered ? result.back : result.forward;
  return trace?.failure ? { stage, failure: trace.failure, at: trace.at } : undefined;
}

const cache = new WeakMap<NetModel, Map<string, ReachProblem | undefined>>();

/** What a ping from one switch at the top of the network to a NIC's address finds, shared among NICs on one subnet. */
function pingFrom(
  model: NetModel,
  anchor: string,
  host: HostPlan,
  ip: number,
): ReachProblem | undefined {
  const key = `${anchor}|${host.gateway}|${model.hostSegments(host.key).join(",")}`;
  const memo = cache.get(model) ?? new Map<string, ReachProblem | undefined>();
  cache.set(model, memo);
  if (!memo.has(key))
    memo.set(key, problemOf(ping(model, { kind: "router", sw: anchor }, ip, anyHost)));
  return memo.get(key);
}

/** The network-level verdict for a server (ignoring whether it is on), shared among servers on one subnet. */
function verdict(model: NetModel, host: HostPlan): ReachProblem | undefined | "n/a" {
  const anchor = anchorOf(model, host.leaf);
  const ip = ipToInt(host.ip);
  if (anchor === undefined || ip === undefined) return "n/a";
  return pingFrom(model, anchor, host, ip);
}

const cutOffs = new WeakMap<NetModel, CutOff[]>();

/** Servers, on or off, that the configuration (and not a cable or power) has cut off. */
function computeCutOff(model: NetModel): CutOff[] {
  const base = model.designed();
  const out: CutOff[] = [];
  for (const host of model.plan.hosts.values()) {
    if (host.rail !== undefined || !model.isAlive(host.leaf)) continue;
    const now = verdict(model, host);
    if (now === "n/a" || now === undefined) continue;
    if (verdict(base, host) === undefined) out.push({ host, problem: now });
  }
  return out;
}

/** The servers that are on and that the configuration has cut off. Cheap while nobody has changed a switch. */
export function cutOffHosts(world: WorldReader): CutOff[] {
  if (!world.hasNetconf()) return [];
  const model = netModelOf(world);
  let all = cutOffs.get(model);
  if (!all) {
    all = computeCutOff(model);
    cutOffs.set(model, all);
  }
  return all.filter((c) => hostIsUp(world, c.host));
}

// ── GPU rails ────────────────────────────────────────────────────────────────────────────────────

/** A server of a GPU cluster that has lost some of its rails: which ones, out of how many. */
export interface RailLoss {
  readonly id: string;
  readonly name: string;
  readonly down: readonly number[];
  readonly total: number;
}

/** Whether a rail NIC can be reached from any switch at the top of the network above its leaf, for any reason. */
function railUp(model: NetModel, host: HostPlan): boolean {
  const ip = ipToInt(host.ip);
  if (ip === undefined || !model.isAlive(host.leaf)) return false;
  return (model.plan.tops.get(host.leaf) ?? []).some(
    (anchor) => model.isAlive(anchor) && pingFrom(model, anchor, host, ip) === undefined,
  );
}

const losses = new WeakMap<NetModel, Map<string, RailLoss>>();

function computeLosses(model: NetModel): Map<string, RailLoss> {
  const out = new Map<string, { name: string; down: number[]; total: number }>();
  for (const host of model.plan.hosts.values()) {
    if (host.rail === undefined) continue;
    const entry = out.get(host.id) ?? { name: host.name, down: [], total: 0 };
    entry.total += 1;
    if (!railUp(model, host)) entry.down.push(host.rail);
    out.set(host.id, entry);
  }
  return new Map([...out].map(([id, e]) => [id, { id, ...e }]));
}

/** The servers that are on and have lost a rail, for any reason (a cable, a leaf without power, a configuration). */
export function railLosses(world: WorldReader): RailLoss[] {
  const model = netModelOf(world);
  let all = losses.get(model);
  if (!all) {
    all = computeLosses(model);
    losses.set(model, all);
  }
  return [...all.values()].filter((l) => {
    const host = model.plan.hosts.get(l.id);
    return l.down.length > 0 && (host === undefined || hostIsUp(world, host));
  });
}
