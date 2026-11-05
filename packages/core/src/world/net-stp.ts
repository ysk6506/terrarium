/**
 * The spanning tree of a legacy domain (REQ-065, ADR-0062), worked out from the cables that carry traffic right
 * now, so it moves when a cable or a switch goes away. Nobody configures it: the gateways are the best
 * bridges (priority 4096, 8192, ...), the leaves have the default 32768, and the root is the best bridge that
 * can still be reached. Every VLAN has the same tree, each hop counts as one step of cost (the OS printers scale
 * it), and what the tree blocks is only shown: pings and traces choose their paths without it.
 */
import { macOf } from "./net-addr";
import type { NetModel } from "./net-model";
import type { Cable } from "./net-plan";

export type StpRole = "root" | "designated" | "alternate";

export interface StpPort {
  readonly n: number;
  readonly peer: string;
  readonly peerPort: number;
  readonly role: StpRole;
}

export interface StpView {
  readonly root: string;
  /** Hops from this bridge to the root (0 on the root). */
  readonly cost: number;
  /** The priority of this bridge and of the root. */
  readonly priority: number;
  readonly rootPriority: number;
  /** The port towards the root; undefined on the root itself. */
  readonly rootPort: number | undefined;
  /** The ports on cables to other switches that carry traffic. */
  readonly ports: readonly StpPort[];
}

const LEAF_PRIORITY = 32_768;
const GATEWAY_PRIORITY = 4096;

interface Edge {
  readonly to: string;
  readonly port: number;
  readonly peerPort: number;
}

interface Bridge {
  readonly id: string;
  readonly priority: number;
  readonly mac: string;
}

const better = (a: Bridge, b: Bridge): boolean =>
  a.priority !== b.priority ? a.priority < b.priority : a.mac < b.mac;

/** Whether a cable between two bridges carries traffic as a switched (not routed) link. */
function carriesFrames(
  model: NetModel,
  bridges: ReadonlyMap<string, Bridge>,
  cable: Cable,
): boolean {
  const [a, b] = [cable.from, cable.to];
  const switched = (sw: string, n: number): boolean => model.portCfg(sw, n).mode !== "routed";
  return (
    bridges.has(a.sw) &&
    bridges.has(b.sw) &&
    model.cableActive(cable) &&
    switched(a.sw, a.n) &&
    switched(b.sw, b.n)
  );
}

/** The bridges of a legacy domain, and the cables between them that carry traffic. */
function graphOf(
  model: NetModel,
  domainIndex: number,
): { bridges: Map<string, Bridge>; edges: Map<string, Edge[]> } {
  const domain = model.plan.domains[domainIndex];
  const bridges = new Map<string, Bridge>();
  if (!domain || domain.fabric !== "legacy") return { bridges, edges: new Map() };
  for (const id of domain.leaves) bridges.set(id, { id, priority: LEAF_PRIORITY, mac: macOf(id) });
  for (const [i, id] of domain.gateways.entries())
    bridges.set(id, { id, priority: GATEWAY_PRIORITY * (i + 1), mac: macOf(id) });
  const edges = new Map<string, Edge[]>();
  for (const cable of model.plan.cables.values()) {
    if (!carriesFrames(model, bridges, cable)) continue;
    const [a, b] = [cable.from, cable.to];
    edges.set(a.sw, [...(edges.get(a.sw) ?? []), { to: b.sw, port: a.n, peerPort: b.n }]);
    edges.set(b.sw, [...(edges.get(b.sw) ?? []), { to: a.sw, port: b.n, peerPort: a.n }]);
  }
  return { bridges, edges };
}

/** The root of the part of the domain a bridge can still reach, and every bridge's hops to it. */
function distancesFrom(
  start: string,
  bridges: ReadonlyMap<string, Bridge>,
  edges: ReadonlyMap<string, readonly Edge[]>,
): Map<string, number> {
  const seen = new Map<string, number>([[start, 0]]);
  const queue = [start];
  for (let i = 0; i < queue.length; i++) {
    const at = queue[i] as string;
    for (const e of edges.get(at) ?? [])
      if (!seen.has(e.to)) {
        seen.set(e.to, (seen.get(at) as number) + 1);
        queue.push(e.to);
      }
  }
  const root = [...seen.keys()]
    .map((id) => bridges.get(id) as Bridge)
    .reduce((best, b) => (better(b, best) ? b : best));
  return root.id === start ? seen : distancesFrom(root.id, bridges, edges);
}

/** The cable a bridge reaches the root by: fewest hops, then the better neighbor, then the lower ports. */
function rootPortOf(
  at: string,
  dist: ReadonlyMap<string, number>,
  bridges: ReadonlyMap<string, Bridge>,
  edges: ReadonlyMap<string, readonly Edge[]>,
): Edge | undefined {
  const mine = dist.get(at) as number;
  const options = (edges.get(at) ?? []).filter((e) => dist.get(e.to) === mine - 1);
  return options.sort((x, y) => {
    const [bx, by] = [bridges.get(x.to) as Bridge, bridges.get(y.to) as Bridge];
    if (bx.id !== by.id) return better(bx, by) ? -1 : 1;
    return x.peerPort - y.peerPort || x.port - y.port;
  })[0];
}

const cache = new WeakMap<NetModel, Map<string, StpView | undefined>>();

/** The spanning tree as seen from a switch; undefined when it is not a bridge of a legacy domain. */
export function stpOf(model: NetModel, sw: string): StpView | undefined {
  const known = cache.get(model) ?? new Map<string, StpView | undefined>();
  cache.set(model, known);
  if (known.has(sw)) return known.get(sw);
  const view = compute(model, sw);
  known.set(sw, view);
  return view;
}

function compute(model: NetModel, sw: string): StpView | undefined {
  const domain = model.plan.switches.get(sw)?.domain;
  if (domain === undefined) return undefined;
  const { bridges, edges } = graphOf(model, domain);
  if (!bridges.has(sw) || !model.isAlive(sw)) return undefined;
  const dist = distancesFrom(sw, bridges, edges);
  const root = [...dist].find(([, d]) => d === 0)?.[0] as string;
  const rootPort = rootPortOf(sw, dist, bridges, edges)?.port;
  const me = dist.get(sw) as number;
  const ports: StpPort[] = (edges.get(sw) ?? [])
    .map((e) => {
      const theirs = dist.get(e.to) as number;
      const designated =
        me !== theirs
          ? me < theirs
          : better(bridges.get(sw) as Bridge, bridges.get(e.to) as Bridge);
      const role: StpRole = designated ? "designated" : e.port === rootPort ? "root" : "alternate";
      return { n: e.port, peer: e.to, peerPort: e.peerPort, role };
    })
    .sort((a, b) => a.n - b.n);
  return {
    root,
    cost: me,
    priority: (bridges.get(sw) as Bridge).priority,
    rootPriority: (bridges.get(root) as Bridge).priority,
    rootPort,
    ports,
  };
}
