/**
 * Where a packet goes (REQ-064, ADR-0061): from a server or a switch to an address, hop by hop, the way
 * IP forwarding does it. A server sends to its own subnet directly or to its gateway; a router delivers to a
 * subnet it is connected to, or follows its longest matching static route whose next hop it can reach.
 * `ping` is a trace there and a trace back: it only succeeds when both directions work.
 */
import { inSubnet, intToIp, ipToInt } from "./net-addr";
import type { RouteCfg } from "./net-config";
import type { Iface, NetModel, Owner } from "./net-model";
import type { HostPlan } from "./net-topology";

export type Endpoint =
  | { readonly kind: "host"; readonly host: HostPlan }
  | { readonly kind: "router"; readonly sw: string };

export type Failure =
  /** The sender has no way onto a network (its cable is down or its port carries nothing). */
  | "no-link"
  /** A server found nobody answering for its gateway address. */
  | "no-gateway"
  | "no-route"
  /** The address is on a connected subnet but nothing there answers for it (ARP fails). */
  | "host-unreachable"
  | "loop";

export interface Hop {
  /** The switch that forwarded the packet. */
  readonly sw: string;
  /** The interface the packet arrived on; its address is what traceroute prints. */
  readonly ingress: Iface;
}

export interface Trace {
  readonly delivered: boolean;
  readonly failure?: Failure;
  /** Where it was delivered, or the device that gave up. */
  readonly at: string;
  readonly hops: readonly Hop[];
  /** The address a router used as the packet's source (its interface towards the destination). */
  readonly srcIp: number;
}

const MAX_HOPS = 32;

/** The interface an owner answers on (a shared gateway address answers with the live switch's own). */
const real = (iface: Iface): Iface => iface.real ?? iface;

interface Next {
  readonly sw: string;
  /** The interface the packet arrives on at the next router. */
  readonly ingress: Iface;
  /** The interface it leaves this router by. */
  readonly egress?: Iface;
}

interface Step {
  /** Where it can go next: several when equal routes exist (the first that gets there wins). */
  readonly next?: readonly Next[];
  readonly done?: { at: string; owner: Owner };
  readonly failure?: Failure;
  readonly egress?: Iface;
}

/** Whether a route's next hop is on a connected interface of this router and something there owns it. */
export function resolveVia(
  model: NetModel,
  sw: string,
  via: number,
): { egress: Iface; owner: Owner } | undefined {
  for (const egress of model.ifacesOf(sw)) {
    if (egress.real || !inSubnet(via, egress.ip, egress.len)) continue;
    const owner = model.ownerIn(via, [egress.seg]);
    if (owner?.kind === "iface" && owner.iface.sw !== sw) return { egress, owner };
  }
  return undefined;
}

/** Like `resolveVia` for a route: a route learned over BGP is usable only while its session is established. */
export function resolveRoute(
  model: NetModel,
  sw: string,
  route: RouteCfg,
): { egress: Iface; owner: Owner } | undefined {
  if (route.proto === "bgp" && model.sessionState(sw, route.via) !== "established")
    return undefined;
  return resolveVia(model, sw, ipToInt(route.via) ?? -1);
}

/** The equal-cost next hops of the longest matching route that has one that can be reached. */
function viaRoutes(model: NetModel, sw: string, dst: number): Next[] {
  const routes = model
    .cfg(sw)
    .routes.filter((r) => inSubnet(dst, ipToInt(r.net) ?? 0, r.len))
    .sort((a, b) => b.len - a.len);
  const usable = routes.flatMap((route) => {
    const hop = resolveRoute(model, sw, route);
    return hop?.owner.kind === "iface"
      ? [
          {
            len: route.len,
            learned: route.proto === "bgp",
            sw: hop.owner.iface.sw,
            ingress: real(hop.owner.iface),
            egress: hop.egress,
          },
        ]
      : [];
  });
  const best = usable[0]?.len;
  const atBest = usable.filter((u) => u.len === best);
  // A static route beats a route learned over BGP for the same prefix length (administrative distance 1 against 200).
  const chosen = atBest.some((u) => !u.learned) ? atBest.filter((u) => !u.learned) : atBest;
  const seen = new Set<string>();
  return chosen
    .filter((u) => !seen.has(u.sw) && seen.add(u.sw))
    .map(({ sw: to, ingress, egress }) => ({ sw: to, ingress, egress }));
}

function routerStep(model: NetModel, sw: string, dst: number): Step {
  const mine = model.ifacesOf(sw);
  const own = mine.find((i) => i.ip === dst && !i.real);
  if (own) return { done: { at: sw, owner: { kind: "iface", iface: own } } };
  const connected = mine
    .filter((i) => !i.real && inSubnet(dst, i.ip, i.len))
    .sort((a, b) => b.len - a.len)[0];
  if (connected) {
    const owner = model.ownerIn(dst, [connected.seg]);
    if (!owner) return { failure: "host-unreachable", egress: connected };
    const at = owner.kind === "host" ? owner.host.id : owner.iface.sw;
    return { done: { at, owner }, egress: connected };
  }
  const next = viaRoutes(model, sw, dst);
  return next.length > 0 ? { next } : { failure: "no-route" };
}

function hostStep(model: NetModel, host: HostPlan, dst: number): Step {
  const segs = model.hostSegments(host.key);
  if (segs.length === 0) return { failure: "no-link" };
  const hostIp = ipToInt(host.ip) ?? 0;
  if (inSubnet(dst, hostIp, host.len)) {
    const owner = model.ownerIn(dst, segs);
    if (!owner) return { failure: "host-unreachable" };
    return { done: { at: owner.kind === "host" ? owner.host.id : owner.iface.sw, owner } };
  }
  const gateway = model.ownerIn(ipToInt(host.gateway) ?? -1, segs);
  if (gateway?.kind !== "iface") return { failure: "no-gateway" };
  return { next: [{ sw: gateway.iface.sw, ingress: real(gateway.iface) }] };
}

interface Walk {
  readonly model: NetModel;
  readonly dst: number;
  readonly hostUp: (host: HostPlan) => boolean;
  /** Steps left before the search gives up (a loop of equal routes could otherwise try every path). */
  budget: number;
  readonly fromRouter: boolean;
}

const firstHop = (walk: Walk, hops: readonly Hop[]): boolean =>
  walk.fromRouter && hops.length === 0;

/** The delivery itself: a server that is off answers nothing. */
function arrive(
  walk: Walk,
  done: NonNullable<Step["done"]>,
  hops: readonly Hop[],
  srcIp: number,
): Trace {
  const gone = done.owner.kind === "host" && !walk.hostUp(done.owner.host);
  return gone
    ? { delivered: false, failure: "host-unreachable", at: done.at, hops, srcIp }
    : { delivered: true, at: done.at, hops, srcIp };
}

/** Goes on to the next router, unless it has been visited already or the search has run out of steps. */
function hopTo(
  walk: Walk,
  next: Next,
  hops: readonly Hop[],
  seen: ReadonlySet<string>,
  srcIp: number,
): Trace {
  const here = firstHop(walk, hops) ? (next.egress?.ip ?? 0) : srcIp;
  if (seen.has(next.sw) || walk.budget-- <= 0 || hops.length >= MAX_HOPS)
    return { delivered: false, failure: "loop", at: next.sw, hops, srcIp: here };
  return advance(
    walk,
    routerStep(walk.model, next.sw, walk.dst),
    next.sw,
    [...hops, { sw: next.sw, ingress: next.ingress }],
    new Set([...seen, next.sw]),
    here,
  );
}

/** Takes one step from `at`, trying each equal-cost next hop in turn until one delivers. */
function advance(
  walk: Walk,
  step: Step,
  at: string,
  hops: readonly Hop[],
  seen: ReadonlySet<string>,
  srcIp: number,
): Trace {
  const first = step.egress && firstHop(walk, hops) ? step.egress.ip : srcIp;
  if (step.done) return arrive(walk, step.done, hops, first);
  let failed: Trace | undefined;
  for (const next of step.next ?? []) {
    const result = hopTo(walk, next, hops, seen, srcIp);
    if (result.delivered) return result;
    failed ??= result;
  }
  return (
    failed ?? { delivered: false, failure: step.failure ?? "no-route", at, hops, srcIp: first }
  );
}

/** Follows a packet from `from` to `dst`; `hostUp` tells whether a server is on (a server that is off answers nothing). */
export function trace(
  model: NetModel,
  from: Endpoint,
  dst: number,
  hostUp: (host: HostPlan) => boolean,
): Trace {
  const walk: Walk = { model, dst, hostUp, budget: 400, fromRouter: from.kind === "router" };
  if (from.kind === "host") {
    const srcIp = ipToInt(from.host.ip) ?? 0;
    return advance(walk, hostStep(model, from.host, dst), from.host.id, [], new Set(), srcIp);
  }
  return advance(walk, routerStep(model, from.sw, dst), from.sw, [], new Set([from.sw]), 0);
}

export interface PingResult {
  readonly ok: boolean;
  readonly forward: Trace;
  /** The way back; absent when the request never arrived. */
  readonly back?: Trace;
}

/** A ping: the request must arrive, and the reply must find its way back to the sender's address. */
export function ping(
  model: NetModel,
  from: Endpoint,
  dst: number,
  hostUp: (host: HostPlan) => boolean,
): PingResult {
  const forward = trace(model, from, dst, hostUp);
  if (!forward.delivered) return { ok: false, forward };
  const replier = replierOf(model, forward.at);
  const srcIp = from.kind === "host" ? (ipToInt(from.host.ip) ?? 0) : forward.srcIp;
  const back = trace(model, replier, srcIp, hostUp);
  return { ok: back.delivered, forward, back };
}

/** Who answers at the place a packet was delivered: a switch (if the address was one of its own) or a server. */
function replierOf(model: NetModel, at: string): Endpoint {
  const host = model.plan.hosts.get(at);
  return host ? { kind: "host", host } : { kind: "router", sw: at };
}

export const ipText = intToIp;
