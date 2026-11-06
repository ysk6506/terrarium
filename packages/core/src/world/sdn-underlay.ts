/**
 * The underlay under the overlay (REQ-097): which switches can still reach which over the cables that carry
 * anything now (the link is up and both ends have power). A VXLAN tunnel between two VTEPs is only as good as this
 * path. It is read off the network model, which is rebuilt when a link or a switch changes, so the answer is cached
 * per model and costs nothing in a step where nothing changed.
 */
import { netModelOf } from "./net-model";
import type { WorldReader } from "./world";

interface Edge {
  readonly to: string;
  readonly linkId: string;
}

const graphs = new WeakMap<object, Map<string, Edge[]>>();
const reaches = new WeakMap<object, Map<string, ReadonlySet<string>>>();

function graphOf(world: WorldReader): { key: object; graph: Map<string, Edge[]> } {
  const model = netModelOf(world);
  const known = graphs.get(model);
  if (known) return { key: model, graph: known };
  const graph = new Map<string, Edge[]>();
  for (const cable of model.plan.cables.values()) {
    if (!model.cableActive(cable)) continue;
    const [a, b] = [cable.from.sw, cable.to.sw];
    graph.set(a, [...(graph.get(a) ?? []), { to: b, linkId: cable.linkId }]);
    graph.set(b, [...(graph.get(b) ?? []), { to: a, linkId: cable.linkId }]);
  }
  graphs.set(model, graph);
  return { key: model, graph };
}

/** The switches reachable from one over active cables (itself included when it has power). */
export function reachableFrom(world: WorldReader, sw: string): ReadonlySet<string> {
  const { key, graph } = graphOf(world);
  const memo = reaches.get(key) ?? new Map<string, ReadonlySet<string>>();
  reaches.set(key, memo);
  const known = memo.get(sw);
  if (known) return known;
  const seen = new Set<string>([sw]);
  const queue = [sw];
  for (let i = 0; i < queue.length; i++)
    for (const e of graph.get(queue[i] as string) ?? [])
      if (!seen.has(e.to)) {
        seen.add(e.to);
        queue.push(e.to);
      }
  memo.set(sw, seen);
  return seen;
}

export interface UnderlayPath {
  /** The switches from one end to the other, both included. */
  readonly switches: readonly string[];
  /** The cables between them. */
  readonly links: readonly string[];
}

/** The shortest path over active cables between two switches, or undefined when there is none. */
export function underlayPath(world: WorldReader, a: string, b: string): UnderlayPath | undefined {
  if (!reachableFrom(world, a).has(b)) return undefined;
  const { graph } = graphOf(world);
  const via = new Map<string, { from: string; linkId: string }>();
  const queue = [a];
  const seen = new Set<string>([a]);
  for (let i = 0; i < queue.length && !seen.has(b); i++)
    for (const e of graph.get(queue[i] as string) ?? [])
      if (!seen.has(e.to)) {
        seen.add(e.to);
        via.set(e.to, { from: queue[i] as string, linkId: e.linkId });
        queue.push(e.to);
      }
  const switches = [b];
  const links: string[] = [];
  for (let at = b; at !== a; ) {
    const step = via.get(at) as { from: string; linkId: string };
    links.unshift(step.linkId);
    switches.unshift(step.from);
    at = step.from;
  }
  return { switches, links };
}

/** How many cables of a switch to other switches carry traffic now (a leaf's ECMP paths). */
export function liveCables(world: WorldReader, sw: string): number {
  return graphOf(world).graph.get(sw)?.length ?? 0;
}

/** The cables of a switch that carry nothing now (down, or the other end has no power), with the switch at the far end. */
export function deadUplinks(
  world: WorldReader,
  sw: string,
): Array<{ linkId: string; peer: string; port: number }> {
  const model = netModelOf(world);
  const out: Array<{ linkId: string; peer: string; port: number }> = [];
  for (const cable of model.plan.cables.values()) {
    if (model.cableActive(cable)) continue;
    if (cable.from.sw === sw)
      out.push({ linkId: cable.linkId, peer: cable.to.sw, port: cable.from.n });
    else if (cable.to.sw === sw)
      out.push({ linkId: cable.linkId, peer: cable.from.sw, port: cable.to.n });
  }
  return out;
}
