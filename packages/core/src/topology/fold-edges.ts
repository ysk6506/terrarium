/**
 * The pipes between tiles and the bars under them. A pipe joins two tiles of neighbouring stages; its count is how
 * many pieces of equipment in the receiving tile lean on something in the supplying one (each counted once), so
 * the thickness says "how many", not "how many cables". The bar under a tile is the same count split by the
 * colour of the receivers: what leans on this tile, and how it is doing.
 */
import type { LayerShape } from "./layers";
import type { Edge, LayerId, Tile, TopoState } from "./types";

const ORDER: readonly TopoState[] = ["fault", "alarm", "impact", "ok"];

const KIND: Readonly<Record<LayerId, Edge["kind"]>> = {
  power: "power",
  cooling: "cold",
  network: "net",
};

/** The pipe is drawn in the colour of the trouble where the trouble is the heat; otherwise by what it carries. */
function kindOf(layer: LayerId, to: Tile): Edge["kind"] {
  if (layer === "cooling" && to.state !== "ok") return "hot";
  return KIND[layer];
}

export interface Joined {
  readonly edges: Edge[];
  /** For each tile, what leans on it by colour, as shares of the receivers. */
  readonly bars: Map<string, ReadonlyArray<readonly [number, TopoState]>>;
}

/** `tileOf` says which tile each piece of equipment is drawn in. */
export function join(
  layer: LayerId,
  shape: LayerShape,
  tiles: readonly Tile[],
  tileOf: ReadonlyMap<string, string>,
): Joined {
  const byId = new Map(tiles.map((t) => [t.id, t]));
  const pipes = new Map<string, number>();
  const shares = new Map<string, Map<TopoState, number>>();
  for (const [consumer, suppliers] of shape.suppliers) {
    const to = tileOf.get(consumer);
    const receiver = to ? byId.get(to) : undefined;
    if (!to || !receiver) continue;
    const seen = new Set<string>();
    for (const supplier of suppliers) {
      const from = tileOf.get(supplier);
      if (!from || seen.has(from)) continue;
      seen.add(from);
      const key = `${from}\n${to}`;
      pipes.set(key, (pipes.get(key) ?? 0) + 1);
      const bar = shares.get(from) ?? new Map<TopoState, number>();
      bar.set(receiver.state, (bar.get(receiver.state) ?? 0) + 1);
      shares.set(from, bar);
    }
  }
  const edges: Edge[] = [];
  for (const [key, count] of pipes) {
    const [from, to] = key.split("\n") as [string, string];
    const source = byId.get(from) as Tile;
    edges.push({
      from,
      to,
      kind: kindOf(layer, byId.get(to) as Tile),
      count,
      live: source.state !== "fault",
    });
  }
  return { edges, bars: barsOf(shares) };
}

function barsOf(shares: ReadonlyMap<string, ReadonlyMap<TopoState, number>>) {
  const out = new Map<string, ReadonlyArray<readonly [number, TopoState]>>();
  for (const [id, counts] of shares) {
    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    out.set(
      id,
      ORDER.filter((s) => counts.has(s)).map(
        (s) => [(counts.get(s) as number) / total, s] as const,
      ),
    );
  }
  return out;
}
