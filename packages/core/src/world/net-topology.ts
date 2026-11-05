/**
 * The shape of the network a blueprint implies (REQ-064, ADR-0061): which switches are access (leaf) switches,
 * which are the gateways above them, which are plain routers; the domain (layer-2 design) each leaf belongs
 * to, its VLAN and subnet; the address of every server. Read from the cables alone.
 *
 *   server ── leaf (ToR, VLAN per rack) ══ trunk ══ gateway (SVIs, shared gateway address)
 *                                                      │ routed /31 links, static routes
 *                                                    core ── core (backbone) ...
 */
import type { Catalog } from "@terrarium/core/catalog";
import type { Entity, Link } from "./blueprint";
import type { BlueprintIndex } from "./graph";
import { type Cidr, intToIp, ipToInt } from "./net-addr";
import type { SwitchCfg } from "./net-config";

export interface Wire {
  /** The port number on the switch: incoming cables first, then outgoing, as SNMP's ifIndex orders them. */
  readonly n: number;
  readonly linkId: string;
  /** Which end of the cable this switch is. */
  readonly end: "from" | "to";
  readonly peerId: string;
}

export type Tier = "leaf" | "gateway" | "router";

/**
 * How a group of racks and the switches above them are built (REQ-065, ADR-0062, REQ-067, ADR-0064).
 * `legacy`: a VLAN per rack, trunks up to gateway switches that hold the VLAN interfaces (the classic
 * access/distribution design). `cloud`: a routed leaf-spine; every uplink is a /31, the gateway of a rack is
 * its own leaf (an anycast address), and the leaves reach each other through the spines. `gpu`: the same routed
 * leaf-spine for the back-end network of a GPU cluster, where each server plugs one NIC per GPU into a different
 * leaf (a rail) and the leaf of rail 3 is the only way the third NIC of every server gets out.
 */
export type Fabric = "legacy" | "cloud" | "gpu";

export const FABRICS: readonly Fabric[] = ["legacy", "cloud", "gpu"];

/** Whether leaves of this fabric route (every uplink a /31, an anycast gateway, BGP) instead of switching. */
export const isRouted = (fabric: Fabric): boolean => fabric !== "legacy";

const isFabric = (value: unknown): value is Fabric =>
  typeof value === "string" && (FABRICS as readonly string[]).includes(value);

export interface SwitchPlan {
  readonly id: string;
  readonly wires: readonly Wire[];
  readonly tier: Tier;
  readonly domain: number | undefined;
  readonly design: SwitchCfg;
}

/**
 * A thing with an address on a leaf switch: a server or a storage array. A server on a GPU fabric has one plan
 * per rail NIC, each with its own address on the leaf of that rail.
 */
export interface HostPlan {
  /** The entity an alarm is raised on. */
  readonly id: string;
  /** Unique among the plans: the entity id, or `<id>#r<n>` for the rail NICs after the first plan of a server. */
  readonly key: string;
  /** Which GPU rail this NIC is on (1-based), for servers cabled to more than one leaf of a GPU fabric. */
  readonly rail?: number;
  readonly name: string;
  readonly ip: string;
  readonly len: number;
  readonly gateway: string;
  readonly vlan: number;
  readonly leaf: string;
  /** The ports it is cabled to, the first one being where its address belongs. */
  readonly ports: ReadonlyArray<{ readonly switchId: string; readonly port: number }>;
}

export interface DomainPlan {
  readonly index: number;
  readonly leaves: readonly string[];
  readonly gateways: readonly string[];
  readonly supernet: Cidr;
  /** From the `fabric` property of the switches of the domain (the first one in id order that has it). */
  readonly fabric: Fabric;
}

export const VLAN_FIRST = 100;
export const VLAN_LAST = 4094;
const HOST_FIRST = 10;
const HOST_LAST = 253;
const SPACE = ipToInt("10.0.0.0") as number;

const byId = (a: { id: string }, b: { id: string }): number =>
  a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/** The cables of a switch in port order. */
export function switchWires(index: BlueprintIndex, id: string): Wire[] {
  const down = index.incoming(id, "network").map((l) => ({ l, end: "to" as const, peer: l.from }));
  const up = index.outgoing(id, "network").map((l) => ({ l, end: "from" as const, peer: l.to }));
  return [...down, ...up].map(({ l, end, peer }, i) => ({
    n: i + 1,
    linkId: l.id,
    end,
    peerId: peer,
  }));
}

/** Facts about the topology that the rest of the design is read from. */
export interface Topology {
  readonly index: BlueprintIndex;
  readonly switches: readonly Entity[];
  readonly wires: ReadonlyMap<string, readonly Wire[]>;
  readonly leaves: ReadonlySet<string>;
  /** Switch ids that are a gateway: not a leaf, with a leaf cabled below them. */
  readonly gateways: ReadonlySet<string>;
  /** Cables between two switches where the lower end is not a leaf: these are routed. */
  readonly routed: readonly Link[];
}

const isHostKind = (e: Entity | undefined): boolean =>
  e?.kind === "server" || e?.kind === "storage";

function leafIds(
  index: BlueprintIndex,
  catalog: Catalog,
  switches: readonly Entity[],
): Set<string> {
  const leaves = new Set<string>();
  for (const sw of switches) {
    const hostBelow = index.incoming(sw.id, "network").some((l) => isHostKind(index.find(l.from)));
    const role = catalog.getOf(sw.modelId ?? "", "switch").role;
    if (hostBelow || role === "tor") leaves.add(sw.id);
  }
  return leaves;
}

export function topologyOf(index: BlueprintIndex, catalog: Catalog): Topology {
  const switches = [...index.ofKind("switch")].sort(byId);
  const leaves = leafIds(index, catalog, switches);
  const gateways = new Set<string>();
  const routed: Link[] = [];
  const isSwitch = (id: string) => index.find(id)?.kind === "switch";
  for (const link of index.allLinks()) {
    if (link.kind !== "network" || !isSwitch(link.from) || !isSwitch(link.to)) continue;
    if (leaves.has(link.from)) {
      if (!leaves.has(link.to)) gateways.add(link.to);
    } else routed.push(link);
  }
  routed.sort((a, b) => (a.id < b.id ? -1 : 1));
  const wires = new Map(switches.map((s) => [s.id, switchWires(index, s.id)]));
  return { index, switches, wires, leaves, gateways, routed };
}

// ── domains: leaves that share a gateway are one layer-2 design ───────────────────────────────

function unionFind(ids: readonly string[]): {
  find: (id: string) => string;
  join: (a: string, b: string) => void;
} {
  const parent = new Map(ids.map((id) => [id, id]));
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root) as string;
    parent.set(id, root);
    return root;
  };
  return {
    find,
    join: (a, b) => {
      const [ra, rb] = [find(a), find(b)];
      if (ra !== rb) parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb);
    },
  };
}

/** A server cabled to this many leaves of one domain has a NIC per rail: that is how a GPU cluster is wired. */
const RAIL_NICS = 4;

/** Whether some server below these switches is cabled to at least `RAIL_NICS` of them. */
function railed(index: BlueprintIndex, members: readonly string[]): boolean {
  const leavesOf = new Map<string, Set<string>>();
  for (const id of members)
    for (const link of index.incoming(id, "network"))
      if (index.find(link.from)?.kind === "server")
        leavesOf.set(link.from, (leavesOf.get(link.from) ?? new Set<string>()).add(id));
  return [...leavesOf.values()].some((set) => set.size >= RAIL_NICS);
}

/**
 * The fabric the switches of a domain say they are built as. When none says, a domain whose servers have a NIC
 * on four or more of its leaves is a GPU fabric (nobody builds that for anything else), and any other is legacy.
 */
function fabricOf(index: BlueprintIndex, members: readonly string[]): Fabric {
  for (const id of [...members].sort()) {
    const wanted = index.find(id)?.props.fabric;
    if (isFabric(wanted)) return wanted;
  }
  return railed(index, members) ? "gpu" : "legacy";
}

/** The domains of a topology, each with the address block its racks' subnets are cut from. */
export function domainsOf(top: Topology): DomainPlan[] {
  const ids = top.switches.map((s) => s.id);
  const sets = unionFind(ids);
  for (const link of top.index.allLinks()) {
    const lowerIsLeaf = top.leaves.has(link.from);
    if (link.kind === "network" && lowerIsLeaf && top.wires.has(link.to))
      sets.join(link.from, link.to);
  }
  const groups = new Map<string, { leaves: string[]; gateways: string[] }>();
  for (const id of ids) {
    const isLeaf = top.leaves.has(id);
    if (!isLeaf && !top.gateways.has(id)) continue;
    const group = groups.get(sets.find(id)) ?? { leaves: [], gateways: [] };
    (isLeaf ? group.leaves : group.gateways).push(id);
    groups.set(sets.find(id), group);
  }
  const ordered = [...groups.values()].filter((g) => g.leaves.length > 0);
  ordered.sort((a, b) => ((a.leaves[0] as string) < (b.leaves[0] as string) ? -1 : 1));
  let block = 0;
  return ordered.map((g, index) => {
    const bits = Math.ceil(Math.log2(Math.max(1, g.leaves.length)));
    const size = 2 ** bits;
    block = Math.ceil(block / size) * size;
    const supernet = { net: SPACE + block * 256, len: 24 - bits };
    block += size;
    const fabric = fabricOf(top.index, [...g.leaves, ...g.gateways]);
    return { index, leaves: g.leaves, gateways: g.gateways, supernet, fabric };
  });
}

/** The `/24` of the k-th leaf of a domain, or undefined when the address space or the VLAN numbers ran out. */
export function leafSubnet(
  domain: DomainPlan,
  k: number,
): { net: number; vlan: number } | undefined {
  const net = domain.supernet.net + k * 256;
  const vlan = VLAN_FIRST + k;
  return vlan <= VLAN_LAST && net < SPACE + 65536 * 256 ? { net, vlan } : undefined;
}

// ── hosts ────────────────────────────────────────────────────────────────────────────────────────

function hostPorts(top: Topology, host: Entity): Array<{ switchId: string; port: number }> {
  const out: Array<{ switchId: string; port: number }> = [];
  for (const link of top.index.outgoing(host.id, "network")) {
    const wire = top.wires.get(link.to)?.find((w) => w.linkId === link.id);
    if (wire && top.leaves.has(link.to)) out.push({ switchId: link.to, port: wire.n });
  }
  return out;
}

interface Candidate {
  readonly id: string;
  readonly key: string;
  readonly rail?: number;
  readonly name: string;
  readonly leaf: string;
  readonly ports: Array<{ switchId: string; port: number }>;
}

/** The plans of one server: one for its ports on ordinary leaves, and one per NIC on a GPU fabric's leaves. */
function plansOf(
  host: Entity,
  ports: Candidate["ports"],
  gpuLeaf: (id: string) => boolean,
): Candidate[] {
  const rails = ports.filter((p) => gpuLeaf(p.switchId));
  const rest = rails.length >= 2 ? ports.filter((p) => !gpuLeaf(p.switchId)) : ports;
  const out: Candidate[] = [];
  const first = rest[0];
  if (first)
    out.push({ id: host.id, key: host.id, name: host.name, leaf: first.switchId, ports: rest });
  if (rails.length < 2) return out;
  rails.forEach((port, i) => {
    const key = out.length === 0 ? host.id : `${host.id}#r${i + 1}`;
    out.push({
      id: host.id,
      key,
      rail: i + 1,
      name: host.name,
      leaf: port.switchId,
      ports: [port],
    });
  });
  return out;
}

function candidates(top: Topology, gpuLeaf: (id: string) => boolean): Candidate[] {
  const out: Candidate[] = [];
  for (const host of [...top.index.ofKind("server"), ...top.index.ofKind("storage")])
    out.push(...plansOf(host, hostPorts(top, host), gpuLeaf));
  return out.sort(byId);
}

/** Every addressed host: the n-th host of a leaf gets the n-th address after the first ten of its subnet. */
export function hostsOf(top: Topology, domains: readonly DomainPlan[]): Map<string, HostPlan> {
  const slot = new Map<string, { net: number; vlan: number }>();
  const gpu = new Set<string>();
  for (const d of domains)
    d.leaves.forEach((leaf, k) => {
      const s = leafSubnet(d, k);
      if (s) slot.set(leaf, s);
      if (d.fabric === "gpu") gpu.add(leaf);
    });
  const used = new Map<string, number>();
  const hosts = new Map<string, HostPlan>();
  for (const c of candidates(top, (id) => gpu.has(id))) {
    const s = slot.get(c.leaf);
    const n = used.get(c.leaf) ?? 0;
    if (!s || HOST_FIRST + n > HOST_LAST) continue;
    used.set(c.leaf, n + 1);
    hosts.set(c.key, {
      id: c.id,
      key: c.key,
      ...(c.rail === undefined ? {} : { rail: c.rail }),
      name: c.name,
      ip: intToIp(s.net + HOST_FIRST + n),
      len: 24,
      gateway: intToIp(s.net + 1),
      vlan: s.vlan,
      leaf: c.leaf,
      ports: c.ports,
    });
  }
  return hosts;
}
