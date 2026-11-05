/**
 * What every switch is configured with when nobody has touched it (REQ-064, ADR-0061), read off the
 * topology: leaves carry their rack's VLAN to the servers and trunk everything up; gateways hold one VLAN
 * interface (SVI) per rack below them and route to the core over /31 links; routers have routed ports, a
 * default route up and one summary route down per domain below. A real campus is configured by hand to
 * look like this; here it is derived so any generated or imported world has a working network.
 */
import type { Link } from "./blueprint";
import { intToIp, ipToInt } from "./net-addr";
import type { PortCfg, RouteCfg, SviCfg, SwitchCfg } from "./net-config";
import {
  type DomainPlan,
  type HostPlan,
  isRouted,
  leafSubnet,
  type SwitchPlan,
  type Tier,
  type Topology,
  type Wire,
} from "./net-topology";

const P2P_BASE = ipToInt("172.16.0.0") as number;

/** The two ends of a routed cable: `from` is the lower switch, `to` the upper. */
export interface P2p {
  readonly from: string;
  readonly to: string;
}

/** Addresses for the routed cables, two to a /31, in cable-id order. */
export function p2pAddresses(routed: readonly Link[]): Map<string, P2p> {
  const out = new Map<string, P2p>();
  routed.forEach((link, i) => {
    out.set(link.id, { from: intToIp(P2P_BASE + 2 * i), to: intToIp(P2P_BASE + 2 * i + 1) });
  });
  return out;
}

/** A VLAN name a person can type: letters, digits, `-` and `_`. */
export const vlanName = (name: string): string =>
  name.replace(/[^A-Za-z0-9_-]+/g, "-").slice(0, 32);

const ACCESS_ONE: PortCfg = { mode: "access", vlan: 1 };
const TRUNK_ALL: PortCfg = { mode: "trunk", allowed: "all", native: 1 };

/** Where each leaf and gateway belongs, and what number the leaf is in its domain. */
interface Placement {
  readonly domain: DomainPlan;
  readonly k: number;
}

function placements(domains: readonly DomainPlan[]): Map<string, Placement> {
  const out = new Map<string, Placement>();
  for (const domain of domains) {
    for (const [k, id] of domain.leaves.entries()) out.set(id, { domain, k });
    for (const id of domain.gateways) out.set(id, { domain, k: -1 });
  }
  return out;
}

/** Whether a switch is in a routed fabric (cloud or GPU): its uplinks are /31 cables running BGP. */
const cloudDomain = (at: Placement | undefined): boolean =>
  at !== undefined && isRouted(at.domain.fabric);

/** The port of a routed cable: the lower switch has the first address of its /31, the upper the second. */
const routedPort = (wire: Wire, ends: P2p): PortCfg => ({
  mode: "routed",
  ip: wire.end === "from" ? ends.from : ends.to,
  len: 31,
});

/** The cables whose two ends are routed: between switches above the leaves, and every uplink of a cloud leaf. */
function routedLinks(top: Topology, at: ReadonlyMap<string, Placement>): Link[] {
  const uplinks = top.index
    .allLinks()
    .filter(
      (l) =>
        l.kind === "network" &&
        top.leaves.has(l.from) &&
        !top.leaves.has(l.to) &&
        top.wires.has(l.to) &&
        cloudDomain(at.get(l.from)),
    );
  return [...top.routed, ...uplinks].sort((a, b) => (a.id < b.id ? -1 : 1));
}

/** The plans of the hosts cabled to each leaf, by server: a rail NIC has its own plan on its own leaf. */
function plansByLeaf(hosts: ReadonlyMap<string, HostPlan>): Map<string, Map<string, HostPlan>> {
  const out = new Map<string, Map<string, HostPlan>>();
  for (const h of hosts.values()) {
    const here = out.get(h.leaf) ?? new Map<string, HostPlan>();
    if (!here.has(h.id)) here.set(h.id, h);
    out.set(h.leaf, here);
  }
  return out;
}

/** The ports of a leaf: routed or trunked towards switches, access in the VLAN of the server cabled to it. */
function leafPorts(
  top: Topology,
  id: string,
  ownVlan: number,
  ctx: { hosts: HostsOnLeaf; p2p: ReadonlyMap<string, P2p>; vlans: Map<number, string> },
): Map<number, PortCfg> {
  const ports = new Map<number, PortCfg>();
  for (const wire of top.wires.get(id) ?? []) {
    const peer = top.index.find(wire.peerId);
    if (peer?.kind === "switch") {
      const ends = ctx.p2p.get(wire.linkId);
      ports.set(wire.n, ends ? routedPort(wire, ends) : TRUNK_ALL);
      continue;
    }
    const { all, here } = ctx.hosts;
    const vlan = here.get(wire.peerId)?.vlan ?? all.get(wire.peerId)?.vlan ?? ownVlan;
    ports.set(wire.n, { mode: "access", vlan });
    if (!ctx.vlans.has(vlan)) ctx.vlans.set(vlan, `V${vlan}`);
  }
  return ports;
}

interface HostsOnLeaf {
  readonly all: ReadonlyMap<string, HostPlan>;
  readonly here: ReadonlyMap<string, HostPlan>;
}

function leafDesign(
  top: Topology,
  id: string,
  at: Placement | undefined,
  hosts: HostsOnLeaf,
  p2p: ReadonlyMap<string, P2p>,
): SwitchCfg {
  const vlans = new Map<number, string>([[1, "default"]]);
  const sub = at ? leafSubnet(at.domain, at.k) : undefined;
  if (sub) vlans.set(sub.vlan, vlanName(top.index.entity(id).name));
  const ports = leafPorts(top, id, sub?.vlan ?? 1, { hosts, p2p, vlans });
  const svis = new Map<number, SviCfg>();
  if (sub && cloudDomain(at))
    svis.set(sub.vlan, { ip: intToIp(sub.net + 1), len: 24, shut: false, anycast: true });
  return { vlans, ports, svis, routes: [], bgpShut: new Set() };
}

function sviFor(domain: DomainPlan, net: number, gateway: string): SviCfg {
  const gateways = domain.gateways;
  if (gateways.length === 1) return { ip: intToIp(net + 1), len: 24, shut: false };
  const own = gateways.indexOf(gateway);
  return { ip: intToIp(net + 2 + own), len: 24, shut: false, virtual: intToIp(net + 1) };
}

function wiresDesign(
  top: Topology,
  id: string,
  p2p: ReadonlyMap<string, P2p>,
  trunkIfLeafBelow: boolean,
): Map<number, PortCfg> {
  const ports = new Map<number, PortCfg>();
  for (const wire of top.wires.get(id) ?? []) {
    const ends = p2p.get(wire.linkId);
    if (ends) ports.set(wire.n, routedPort(wire, ends));
    else if (trunkIfLeafBelow) ports.set(wire.n, TRUNK_ALL);
  }
  return ports;
}

/** The VLANs and VLAN interfaces a gateway holds: one per rack in its domain. */
function gatewayVlans(
  top: Topology,
  id: string,
  domain: DomainPlan,
): { vlans: Map<number, string>; svis: Map<number, SviCfg> } {
  const vlans = new Map<number, string>([[1, "default"]]);
  const svis = new Map<number, SviCfg>();
  domain.leaves.forEach((leaf, k) => {
    const sub = leafSubnet(domain, k);
    if (!sub) return;
    vlans.set(sub.vlan, vlanName(top.index.entity(leaf).name));
    svis.set(sub.vlan, sviFor(domain, sub.net, id));
  });
  return { vlans, svis };
}

/** The domains behind a switch: its own, and those of everything routed below it. */
function belowOf(top: Topology, at: ReadonlyMap<string, Placement>): (id: string) => Set<number> {
  const memo = new Map<string, Set<number>>();
  const below = (id: string, seen: ReadonlySet<string>): Set<number> => {
    const known = memo.get(id);
    if (known) return known;
    const own = at.get(id);
    const out = new Set<number>(top.gateways.has(id) && own ? [own.domain.index] : []);
    for (const link of top.routed)
      if (link.to === id && !seen.has(link.from))
        for (const d of below(link.from, new Set([...seen, id]))) out.add(d);
    memo.set(id, out);
    return out;
  };
  return (id) => below(id, new Set());
}

/** Whether a cable is the uplink of a cloud leaf: an eBGP session, whose routes are learned, not typed. */
const isUplink = (at: ReadonlyMap<string, Placement>, link: Link): boolean => {
  const place = at.get(link.from);
  return place !== undefined && place.k >= 0 && cloudDomain(place);
};

/** The /24 of the cloud leaf at the lower end of a cable, which the spine at its upper end routes to. */
function leafRoute(at: ReadonlyMap<string, Placement>, leaf: string, via: string): RouteCfg[] {
  const place = at.get(leaf);
  const sub =
    place && place.k >= 0 && cloudDomain(place) ? leafSubnet(place.domain, place.k) : undefined;
  return sub ? [{ net: intToIp(sub.net), len: 24, via, proto: "bgp" }] : [];
}

interface RouteInputs {
  readonly routed: readonly Link[];
  readonly p2p: ReadonlyMap<string, P2p>;
  readonly domains: readonly DomainPlan[];
  readonly at: ReadonlyMap<string, Placement>;
  readonly below: (id: string) => Set<number>;
}

function routesFor(id: string, r: RouteInputs): RouteCfg[] {
  const routes: RouteCfg[] = [];
  for (const link of r.routed) {
    const ends = r.p2p.get(link.id);
    if (!ends) continue;
    if (link.from === id)
      routes.push({
        net: "0.0.0.0",
        len: 0,
        via: ends.to,
        ...(isUplink(r.at, link) ? { proto: "bgp" as const } : {}),
      });
    if (link.to !== id) continue;
    for (const d of [...r.below(link.from)].sort((a, b) => a - b)) {
      const s = (r.domains[d] as DomainPlan).supernet;
      routes.push({ net: intToIp(s.net), len: s.len, via: ends.from });
    }
    routes.push(...leafRoute(r.at, link.from, ends.from));
  }
  return routes;
}

const tierOf = (top: Topology, id: string): Tier =>
  top.leaves.has(id) ? "leaf" : top.gateways.has(id) ? "gateway" : "router";

/** The unmodified configuration of every switch. */
export function designSwitches(
  top: Topology,
  domains: readonly DomainPlan[],
  hosts: ReadonlyMap<string, HostPlan>,
): Map<string, SwitchPlan> {
  const at = placements(domains);
  const routed = routedLinks(top, at);
  const p2p = p2pAddresses(routed);
  const inputs: RouteInputs = { routed, p2p, domains, at, below: belowOf(top, at) };
  const onLeaf = plansByLeaf(hosts);
  const out = new Map<string, SwitchPlan>();
  for (const sw of top.switches) {
    const place = at.get(sw.id);
    const tier = tierOf(top, sw.id);
    const wires: readonly Wire[] = top.wires.get(sw.id) ?? [];
    const design =
      tier === "leaf"
        ? designLeaf(top, sw.id, place, {
            hosts: { all: hosts, here: onLeaf.get(sw.id) ?? new Map() },
            p2p,
            inputs,
          })
        : designAbove(top, sw.id, tier, place, { p2p, inputs });
    out.set(sw.id, { id: sw.id, wires, tier, domain: place?.domain.index, design });
  }
  return out;
}

function designLeaf(
  top: Topology,
  id: string,
  place: Placement | undefined,
  ctx: { hosts: HostsOnLeaf; p2p: ReadonlyMap<string, P2p>; inputs: RouteInputs },
): SwitchCfg {
  const leaf = leafDesign(top, id, place, ctx.hosts, ctx.p2p);
  return cloudDomain(place) ? { ...leaf, routes: routesFor(id, ctx.inputs) } : leaf;
}

function designAbove(
  top: Topology,
  id: string,
  tier: Tier,
  place: Placement | undefined,
  ctx: { p2p: ReadonlyMap<string, P2p>; inputs: RouteInputs },
): SwitchCfg {
  const trunks = tier === "gateway" && !cloudDomain(place);
  const v = place && trunks ? gatewayVlans(top, id, place.domain) : undefined;
  return {
    vlans: v?.vlans ?? new Map([[1, "default"]]),
    ports: wiresDesign(top, id, ctx.p2p, trunks),
    svis: v?.svis ?? new Map(),
    routes: routesFor(id, ctx.inputs),
    bgpShut: new Set(),
  };
}

export { ACCESS_ONE };
