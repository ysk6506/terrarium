/**
 * The network as it stands right now (REQ-064, ADR-0061): which switch ports carry which VLAN, which
 * (switch, VLAN) pairs are one broadcast domain, which interfaces are up and own which address, and where
 * every server is plugged in. It is built from the design (net-plan.ts), the operators' changes
 * (the world's `netconf`), the state of the links and which switches have power. It does not depend on
 * whether a server is on: a server that is off still has its address, it just does not answer.
 */

import { ipToInt } from "./net-addr";
import type { BgpPlan } from "./net-bgp";
import { carries, effectiveCfg, type PortCfg, type SviCfg, type SwitchCfg } from "./net-config";
import type { Cable, NetPlan } from "./net-plan";
import { planOf } from "./net-plan";
import type { HostPlan } from "./net-topology";
import type { WorldReader } from "./world";

export interface Iface {
  readonly sw: string;
  readonly kind: "svi" | "routed";
  readonly vlan?: number;
  readonly port?: number;
  readonly ip: number;
  readonly len: number;
  /** The broadcast domain (≥ 0) or point-to-point cable (< 0) the interface is on. */
  readonly seg: number;
  /** For a shared gateway address: the switch's own interface that currently answers for it. */
  readonly real?: Iface;
}

export type Owner =
  | { readonly kind: "iface"; readonly iface: Iface }
  | { readonly kind: "host"; readonly host: HostPlan };

const ACCESS_ONE: PortCfg = { mode: "access", vlan: 1 };
const nodeKey = (sw: string, vlan: number): string => `${sw}\u0000${vlan}`;

/** Union-find over (switch, VLAN) pairs: two pairs joined by an active cable carrying that VLAN are one segment. */
class Segments {
  private readonly ids = new Map<string, number>();
  private readonly parent: number[] = [];
  private readonly live: boolean[] = [];
  readonly edges: Array<Array<{ to: number; port: number }>> = [];
  readonly names: Array<{ sw: string; vlan: number }> = [];

  node(sw: string, vlan: number): number {
    const key = nodeKey(sw, vlan);
    const known = this.ids.get(key);
    if (known !== undefined) return known;
    const id = this.parent.length;
    this.ids.set(key, id);
    this.parent.push(id);
    this.live.push(false);
    this.edges.push([]);
    this.names.push({ sw, vlan });
    return id;
  }

  find(i: number): number {
    let root = i;
    while (this.parent[root] !== root) root = this.parent[root] as number;
    this.parent[i] = root;
    return root;
  }

  join(a: number, b: number, portA: number, portB: number): void {
    const [ra, rb] = [this.find(a), this.find(b)];
    if (ra !== rb) this.parent[ra < rb ? rb : ra] = ra < rb ? ra : rb;
    this.edges[a]?.push({ to: b, port: portA });
    this.edges[b]?.push({ to: a, port: portB });
  }

  member(i: number): void {
    this.live[i] = true;
  }

  hasMember(i: number): boolean {
    return this.live[i] === true;
  }

  has(sw: string, vlan: number): number | undefined {
    return this.ids.get(nodeKey(sw, vlan));
  }
}

type Trunk = Extract<PortCfg, { mode: "trunk" }>;
type Access = Extract<PortCfg, { mode: "access" }>;
type Db = ReadonlyMap<number, string>;

/** An access port sends its VLAN untagged; a trunk reads untagged frames as its native VLAN. */
function accessToTrunk(access: Access, aDb: Db, trunk: Trunk, tDb: Db): Array<[number, number]> {
  if (!aDb.has(access.vlan) || !carries(trunk, trunk.native, tDb)) return [];
  return [[access.vlan, trunk.native]];
}

/** Two trunks join each VLAN both carry (and both switches know). */
function trunkToTrunk(pa: Trunk, da: Db, pb: Trunk, db: Db): Array<[number, number]> {
  return [...da.keys()].filter((v) => carries(pa, v, da) && carries(pb, v, db)).map((v) => [v, v]);
}

/** The VLAN pairs one active cable joins, given both ends' port configurations. */
function vlanPairs(pa: PortCfg, da: Db, pb: PortCfg, db: Db): Array<[number, number]> {
  if (pa.mode === "routed" || pb.mode === "routed") return [];
  if (pa.mode === "trunk" && pb.mode === "trunk") return trunkToTrunk(pa, da, pb, db);
  if (pa.mode === "access" && pb.mode === "access")
    return da.has(pa.vlan) && db.has(pb.vlan) ? [[pa.vlan, pb.vlan]] : [];
  if (pa.mode === "access") return accessToTrunk(pa, da, pb as Trunk, db);
  return accessToTrunk(pb as Access, db, pa as Trunk, da).map(([x, y]) => [y, x]);
}

export class NetModel {
  readonly plan: NetPlan;
  private readonly cfgs = new Map<string, SwitchCfg>();
  private readonly alive = new Set<string>();
  private readonly segments = new Segments();
  private readonly bySwitch = new Map<string, Iface[]>();
  private readonly byIp = new Map<number, Iface[]>();
  private readonly bySeg = new Map<number, Iface[]>();
  private readonly hostSegs = new Map<string, number[]>();
  private readonly hostAt = new Map<number, HostPlan>();
  private readonly p2p = new Map<string, number>();
  /** The hosts plugged into each (switch, VLAN) node, with the port they use. */
  private readonly attached = new Map<number, Array<{ host: HostPlan; port: number }>>();

  private twin: NetModel | undefined;

  /** `useConfig: false` builds the network as designed, ignoring what operators changed. */
  constructor(
    private readonly world: WorldReader,
    private readonly useConfig = true,
  ) {
    this.plan = planOf(world.index, world.catalog);
    for (const id of this.plan.switches.keys()) if (switchAlive(world, id)) this.alive.add(id);
    this.joinCables();
    this.attachHosts();
    this.collectInterfaces();
  }

  isAlive = (sw: string): boolean => this.alive.has(sw);

  /** The same network with every switch as designed (the links and power are as they are now). */
  designed(): NetModel {
    this.twin ??= this.useConfig ? new NetModel(this.world, false) : this;
    return this.twin;
  }

  cfg(sw: string): SwitchCfg {
    const known = this.cfgs.get(sw);
    if (known) return known;
    const design = (this.plan.switches.get(sw) as { design: SwitchCfg }).design;
    const cfg = this.useConfig ? effectiveCfg(design, this.world.netconf(sw)) : design;
    this.cfgs.set(sw, cfg);
    return cfg;
  }

  portCfg(sw: string, n: number): PortCfg {
    return this.cfg(sw).ports.get(n) ?? ACCESS_ONE;
  }

  ifacesOf(sw: string): readonly Iface[] {
    return this.bySwitch.get(sw) ?? [];
  }

  /** Every interface that is up on a segment (a broadcast domain or a point-to-point cable). */
  ifacesOn(seg: number): readonly Iface[] {
    return this.bySeg.get(seg) ?? [];
  }

  /** The segments a NIC (a host plan, by its key) is plugged into. */
  hostSegments(key: string): readonly number[] {
    return this.hostSegs.get(key) ?? [];
  }

  /** What owns an address in any of these segments: an interface that is up, or a server (whether or not it is on). */
  ownerIn(ip: number, segs: readonly number[]): Owner | undefined {
    for (const iface of this.byIp.get(ip) ?? [])
      if (segs.includes(iface.seg)) return { kind: "iface", iface };
    const host = this.hostAt.get(ip);
    const mine = host ? this.hostSegs.get(host.key) : undefined;
    return host && mine?.some((s) => segs.includes(s)) ? { kind: "host", host } : undefined;
  }

  /** Every switch (and VLAN) in the same segment as this one, with the port to leave by from here: for MAC learning. */
  reach(sw: string, vlan: number): Array<{ sw: string; vlan: number; port: number }> {
    const start = this.segments.has(sw, vlan);
    if (start === undefined) return [];
    const first = new Map<number, number>([[start, 0]]);
    const queue = [start];
    for (let i = 0; i < queue.length; i++) {
      const from = queue[i] as number;
      for (const e of this.segments.edges[from] ?? []) {
        if (first.has(e.to)) continue;
        first.set(e.to, from === start ? e.port : (first.get(from) as number));
        queue.push(e.to);
      }
    }
    return [...first].map(([node, port]) => ({
      ...(this.segments.names[node] as { sw: string; vlan: number }),
      port,
    }));
  }

  /** The hosts plugged into a (switch, VLAN), with the port. */
  hostsAt(sw: string, vlan: number): ReadonlyArray<{ host: HostPlan; port: number }> {
    const node = this.segments.has(sw, vlan);
    return node === undefined ? [] : (this.attached.get(node) ?? []);
  }

  /** The BGP plan of a switch (AS number, router id, neighbors); undefined when it does not speak BGP. */
  bgp(sw: string): BgpPlan | undefined {
    return this.plan.bgp.get(sw);
  }

  /** The state of the BGP session to a neighbor of a switch; undefined when the switch has no such neighbor. */
  sessionState(sw: string, ip: string): "established" | "shutdown" | "down" | undefined {
    const n = this.plan.bgp.get(sw)?.neighbors.find((x) => x.ip === ip);
    const cable = n ? this.plan.cables.get(n.linkId) : undefined;
    if (!n || !cable) return undefined;
    if (this.cfg(sw).bgpShut.has(ip)) return "shutdown";
    const back = this.plan.bgp.get(n.peer)?.neighbors.find((x) => x.linkId === n.linkId);
    const peerShut = back !== undefined && this.cfg(n.peer).bgpShut.has(back.ip);
    return this.cableActive(cable) && !peerShut ? "established" : "down";
  }

  /** Whether a cable between two switches carries anything: its link is up and both ends have power. */
  cableActive(cable: Cable): boolean {
    return (
      this.world.linkUp(cable.linkId) &&
      this.alive.has(cable.from.sw) &&
      this.alive.has(cable.to.sw)
    );
  }

  /** A port is a member of every VLAN it carries as soon as its cable is up. */
  private markPort(sw: string, n: number): void {
    const cfg = this.cfg(sw);
    const port = this.portCfg(sw, n);
    for (const v of cfg.vlans.keys())
      if (carries(port, v, cfg.vlans)) this.segments.member(this.segments.node(sw, v));
  }

  private joinCables(): void {
    for (const cable of this.plan.cables.values()) {
      if (!this.cableActive(cable)) continue;
      const [a, b] = [cable.from, cable.to];
      this.markPort(a.sw, a.n);
      this.markPort(b.sw, b.n);
      const [ca, cb] = [this.cfg(a.sw), this.cfg(b.sw)];
      for (const [va, vb] of vlanPairs(
        this.portCfg(a.sw, a.n),
        ca.vlans,
        this.portCfg(b.sw, b.n),
        cb.vlans,
      ))
        this.segments.join(this.segments.node(a.sw, va), this.segments.node(b.sw, vb), a.n, b.n);
    }
  }

  /** The VLAN a host's port puts it in: an access port's own, a trunk's native VLAN. */
  private vlanOfPort(sw: string, n: number): number | undefined {
    const cfg = this.cfg(sw);
    const port = this.portCfg(sw, n);
    if (port.mode === "routed") return undefined;
    const vlan = port.mode === "access" ? port.vlan : port.native;
    return carries(port, vlan, cfg.vlans) ? vlan : undefined;
  }

  private attachHosts(): void {
    for (const host of this.plan.hosts.values()) {
      const segs: number[] = [];
      for (const { switchId, port } of host.ports) {
        const at = this.attachPoint(host, switchId, port);
        if (at === undefined) continue;
        const node = this.segments.node(switchId, at);
        this.markPort(switchId, port);
        segs.push(node);
        const list = this.attached.get(node) ?? [];
        list.push({ host, port });
        this.attached.set(node, list);
      }
      this.hostSegs.set(
        host.key,
        segs.map((n) => this.segments.find(n)),
      );
      const ip = ipToInt(host.ip);
      if (ip !== undefined) this.hostAt.set(ip, host);
    }
  }

  /** The VLAN a host is plugged into on a leaf, or undefined when its cable is down or the port carries nothing. */
  private attachPoint(host: HostPlan, sw: string, port: number): number | undefined {
    if (!this.alive.has(sw)) return undefined;
    if (port === 0) return this.cfg(sw).vlans.has(host.vlan) ? host.vlan : undefined;
    const wire = this.plan.switches.get(sw)?.wires[port - 1];
    if (!wire || !this.world.linkUp(wire.linkId)) return undefined;
    return this.vlanOfPort(sw, port);
  }

  private add(iface: Iface): void {
    const list = this.bySwitch.get(iface.sw) ?? [];
    list.push(iface);
    this.bySwitch.set(iface.sw, list);
    const owners = this.byIp.get(iface.ip) ?? [];
    owners.push(iface);
    this.byIp.set(iface.ip, owners);
    const onSeg = this.bySeg.get(iface.seg) ?? [];
    onSeg.push(iface);
    this.bySeg.set(iface.seg, onSeg);
  }

  private p2pSeg(linkId: string): number {
    const known = this.p2p.get(linkId);
    if (known !== undefined) return known;
    const id = -1 - this.p2p.size;
    this.p2p.set(linkId, id);
    return id;
  }

  /** The interface of a VLAN interface that is up, has an address and sits on a segment with members. */
  private sviIface(sw: string, vlan: number, svi: SviCfg, cfg: SwitchCfg): Iface | undefined {
    const node = this.segments.has(sw, vlan);
    const ip = ipToInt(svi.ip);
    const usable = !svi.shut && cfg.vlans.has(vlan) && node !== undefined;
    if (!usable || !this.segments.hasMember(node) || ip === undefined || ip === 0) return undefined;
    return { sw, kind: "svi", vlan, ip, len: svi.len, seg: this.segments.find(node) };
  }

  private collectInterfaces(): void {
    const virtuals = new Map<string, Iface[]>();
    for (const sw of [...this.alive].sort()) {
      const cfg = this.cfg(sw);
      for (const [vlan, svi] of cfg.svis) {
        const iface = this.sviIface(sw, vlan, svi, cfg);
        if (!iface) continue;
        this.add(iface);
        const virtual = svi.virtual === undefined ? undefined : ipToInt(svi.virtual);
        if (virtual === undefined) continue;
        const key = `${virtual}|${iface.seg}`;
        virtuals.set(key, [...(virtuals.get(key) ?? []), iface]);
      }
      this.routedInterfaces(sw, cfg);
    }
    for (const [key, group] of virtuals) {
      const real = group[0] as Iface;
      this.add({ ...real, ip: Number(key.split("|")[0]), real });
    }
  }

  private routedInterfaces(sw: string, cfg: SwitchCfg): void {
    for (const [n, port] of cfg.ports) {
      if (port.mode !== "routed" || port.ip === undefined || port.len === undefined) continue;
      const wire = this.plan.switches.get(sw)?.wires[n - 1];
      const cable = wire ? this.plan.cables.get(wire.linkId) : undefined;
      const ip = ipToInt(port.ip);
      if (!wire || !cable || ip === undefined || !this.cableActive(cable)) continue;
      this.add({ sw, kind: "routed", port: n, ip, len: port.len, seg: this.p2pSeg(wire.linkId) });
    }
  }
}

/** A switch carries traffic when it has power, nobody switched it off and it has not failed. */
export function switchAlive(world: WorldReader, id: string): boolean {
  const state = world.stateAs(id, "switch");
  return (
    state.powered && state.adminOn && !world.faultsOn(id).some((f) => f.type === "switch_failure")
  );
}

const memo = new WeakMap<WorldReader, { sig: string; model: NetModel }>();

/** The model of the world as it is now; rebuilt only when a configuration, a link or a switch's power changed. */
export function netModelOf(world: WorldReader): NetModel {
  const plan = planOf(world.index, world.catalog);
  const dead: string[] = [];
  for (const id of plan.switches.keys()) if (!switchAlive(world, id)) dead.push(id);
  const sig = `${world.netEpoch()}|${dead.join(",")}`;
  const known = memo.get(world);
  if (known?.sig === sig) return known.model;
  const model = new NetModel(world);
  memo.set(world, { sig, model });
  return model;
}
