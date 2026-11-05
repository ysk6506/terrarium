/**
 * The network design of a blueprint (REQ-064, ADR-0061): the topology (net-topology.ts) with every switch's
 * unmodified configuration (net-design.ts), computed once per blueprint from the cables alone. The world's
 * network model (net-model.ts) reads it and lays operators' changes over it.
 */
import type { Catalog } from "@terrarium/core/catalog";
import type { BlueprintIndex } from "./graph";
import { type BgpPlan, bgpPlans } from "./net-bgp";
import { designSwitches } from "./net-design";
import {
  type DomainPlan,
  domainsOf,
  type HostPlan,
  hostsOf,
  type SwitchPlan,
  type Topology,
  topologyOf,
} from "./net-topology";

export interface NetPlan {
  readonly switches: ReadonlyMap<string, SwitchPlan>;
  readonly hosts: ReadonlyMap<string, HostPlan>;
  readonly domains: readonly DomainPlan[];
  /** Per leaf, the switches at the top of the network above it, which monitoring pings from (first alive wins). */
  readonly tops: ReadonlyMap<string, readonly string[]>;
  /** The cables between two switches, with the port each end is plugged into. */
  readonly cables: ReadonlyMap<string, Cable>;
  /** The switches that speak BGP (the leaves and spines of cloud fabrics) and whom they peer with. */
  readonly bgp: ReadonlyMap<string, BgpPlan>;
}

export interface Cable {
  readonly linkId: string;
  readonly from: { readonly sw: string; readonly n: number };
  readonly to: { readonly sw: string; readonly n: number };
}

/** Every cable whose two ends are switch ports. */
function cablesOf(switches: ReadonlyMap<string, SwitchPlan>): Map<string, Cable> {
  const ends = new Map<string, { sw: string; n: number; end: "from" | "to" }[]>();
  for (const sw of switches.values())
    for (const w of sw.wires) {
      const list = ends.get(w.linkId) ?? [];
      list.push({ sw: sw.id, n: w.n, end: w.end });
      ends.set(w.linkId, list);
    }
  const out = new Map<string, Cable>();
  for (const [linkId, list] of ends) {
    const from = list.find((e) => e.end === "from");
    const to = list.find((e) => e.end === "to");
    if (from && to) out.set(linkId, { linkId, from, to });
  }
  return out;
}

/** The switches above a switch, through every cable that leaves it towards another switch. */
function topsOf(top: Topology): Map<string, string[]> {
  const memo = new Map<string, string[]>();
  const climb = (id: string, seen: Set<string>): string[] => {
    const known = memo.get(id);
    if (known) return known;
    const ups = top.index
      .outgoing(id, "network")
      .map((l) => l.to)
      .filter((to) => top.wires.has(to));
    const next = ups.filter((u) => !seen.has(u));
    const found =
      ups.length === 0
        ? [id]
        : [...new Set(next.flatMap((u) => climb(u, new Set([...seen, id]))))].sort();
    memo.set(id, found);
    return found;
  };
  const out = new Map<string, string[]>();
  for (const leaf of top.leaves) {
    const tops = climb(leaf, new Set()).filter((t) => t !== leaf);
    out.set(leaf, tops);
  }
  return out;
}

const plans = new WeakMap<BlueprintIndex, NetPlan>();

/** The design of the network the blueprint describes; computed once per blueprint. */
export function planOf(index: BlueprintIndex, catalog: Catalog): NetPlan {
  const known = plans.get(index);
  if (known) return known;
  const top = topologyOf(index, catalog);
  const domains = domainsOf(top);
  const hosts = hostsOf(top, domains);
  const switches = designSwitches(top, domains, hosts);
  const cables = cablesOf(switches);
  const bgp = bgpPlans(switches, domains, cables);
  const plan: NetPlan = { switches, hosts, domains, tops: topsOf(top), cables, bgp };
  plans.set(index, plan);
  return plan;
}
