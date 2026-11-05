/**
 * BGP in a cloud fabric (REQ-065, ADR-0062): every cable between a leaf and a spine is one eBGP session, the
 * way a leaf-spine data centre is run. Nothing here is configured by hand or converges over time. The sessions,
 * their AS numbers and the routes they carry are derived from the cables; a session is up when its cable is up
 * and nobody has shut either end, and the routes it carries exist only while it is up.
 */
import type { Cable } from "./net-plan";
import type { DomainPlan, SwitchPlan } from "./net-topology";

/** Private 4-byte AS numbers (RFC 6996): one for all the spines of a domain, one for each leaf. */
const SPINE_AS = 4_200_000_000;
const LEAF_AS = 4_210_000_000;
const LEAF_AS_STRIDE = 10_000;

export interface BgpNeighbor {
  /** The address of the neighbor on the cable between the two. */
  readonly ip: string;
  readonly remoteAs: number;
  readonly peer: string;
  readonly linkId: string;
  /** The port of this switch the cable is on. */
  readonly port: number;
}

export interface BgpPlan {
  readonly asn: number;
  readonly routerId: string;
  readonly neighbors: readonly BgpNeighbor[];
}

const asnOf = (d: DomainPlan, id: string): number => {
  const k = d.leaves.indexOf(id);
  return k < 0 ? SPINE_AS + d.index : LEAF_AS + d.index * LEAF_AS_STRIDE + k;
};

const portIp = (plan: SwitchPlan | undefined, n: number): string | undefined => {
  const port = plan?.design.ports.get(n);
  return port?.mode === "routed" ? port.ip : undefined;
};

/** The BGP neighbors of every switch of a cloud domain, from the cables between its leaves and spines. */
function neighborsOf(
  switches: ReadonlyMap<string, SwitchPlan>,
  domains: readonly DomainPlan[],
  cables: ReadonlyMap<string, Cable>,
): Map<string, BgpNeighbor[]> {
  const out = new Map<string, BgpNeighbor[]>();
  for (const cable of cables.values()) {
    const leaf = switches.get(cable.from.sw);
    const spine = switches.get(cable.to.sw);
    const d = leaf?.domain === undefined ? undefined : domains[leaf.domain];
    if (!leaf || !spine || !d || d.fabric === "legacy") continue;
    if (leaf.tier !== "leaf" || spine.tier !== "gateway" || spine.domain !== leaf.domain) continue;
    const [leafIp, spineIp] = [portIp(leaf, cable.from.n), portIp(spine, cable.to.n)];
    if (leafIp === undefined || spineIp === undefined) continue;
    const add = (id: string, n: BgpNeighbor): void => {
      out.set(id, [...(out.get(id) ?? []), n]);
    };
    add(leaf.id, {
      ip: spineIp,
      remoteAs: asnOf(d, spine.id),
      peer: spine.id,
      linkId: cable.linkId,
      port: cable.from.n,
    });
    add(spine.id, {
      ip: leafIp,
      remoteAs: asnOf(d, leaf.id),
      peer: leaf.id,
      linkId: cable.linkId,
      port: cable.to.n,
    });
  }
  return out;
}

/** The BGP plan of every switch that speaks it: AS number, router id (`10.255.x.y`) and neighbors. */
export function bgpPlans(
  switches: ReadonlyMap<string, SwitchPlan>,
  domains: readonly DomainPlan[],
  cables: ReadonlyMap<string, Cable>,
): Map<string, BgpPlan> {
  const found = neighborsOf(switches, domains, cables);
  const out = new Map<string, BgpPlan>();
  [...found.keys()].sort().forEach((id, i) => {
    const d = domains[switches.get(id)?.domain ?? 0] as DomainPlan;
    const n = i + 1;
    out.set(id, {
      asn: asnOf(d, id),
      routerId: `10.255.${(n >> 8) & 255}.${n & 255}`,
      neighbors: (found.get(id) ?? []).sort((a, b) => a.port - b.port),
    });
  });
  return out;
}
