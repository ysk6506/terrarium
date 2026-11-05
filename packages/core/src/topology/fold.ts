/**
 * Fold the same, unfold the different (REQ-078, ADR-0084). The board of a layer holds a tile for every piece of
 * equipment that is broken, alarming, touched by an agent or asked for, and one group tile for the rest of each
 * kind of state, however big the world is. Which containers the viewer has opened decides how finely the groups
 * are split, and the board never holds more than 150 tiles: each stage gets an equal share of them, and a stage that
 * does not fit is folded further until it does.
 */

import { join } from "./fold-edges";
import { type Bucket, CLASSES, fit, ROOT } from "./fold-groups";
import { pinsOf } from "./fold-pins";
import { type Impact, impactOf } from "./impact";
import {
  chainOf,
  type LayerShape,
  layerShape,
  nodeOf,
  type Status,
  serversReaching,
  statusOf,
} from "./layers";
import {
  type Board,
  type Crumb,
  type LayerId,
  MAX_TILES,
  type Tile,
  type TileClass,
  type TopoKind,
  type TopologySource,
  type TopoState,
} from "./types";
import { groupName, num } from "./words";

/** Where the viewer is looking from: the picked equipment, and how far to follow what it leans on or what leans on it. */
export interface Focus {
  readonly id: string;
  /** Steps to follow from it; 2 when left out. */
  readonly hops?: number;
  /** `up` is what it leans on, `down` what leans on it; `auto` goes up from a rack or a server and down from the rest. */
  readonly direction?: "up" | "down" | "auto";
}

export interface FoldOptions {
  readonly layer: LayerId;
  /** The containers opened so far, from the site down; none opened folds all of a class into one tile. */
  readonly path?: readonly string[];
  readonly focus?: Focus;
  /** At most this many tiles (never more than 150). */
  readonly limit?: number;
}

/** A stage with this few pieces of equipment is drawn whole: there is nothing to fold. */
const SMALL_STAGE = 8;

const SEVERITY: Readonly<Record<TileClass, number>> = {
  fault: 0,
  alarm: 1,
  touch: 2,
  impact: 3,
  ok: 4,
};

interface Context {
  readonly source: TopologySource;
  readonly shape: LayerShape;
  readonly status: Status;
  readonly layer: LayerId;
  readonly opened: readonly string[];
  readonly focus: string | undefined;
}

function singleTile(c: Context, stage: number, id: string): Tile {
  const node = nodeOf(c.source, c.shape, c.layer, c.status, id);
  return {
    id,
    stage,
    kind: node.kind,
    group: false,
    name: node.name,
    line: node.line,
    state: node.state,
    touched: node.touched,
    count: 1,
    servers: node.servers,
    bar: [],
    focus: id === c.focus,
  };
}

const prefixOf = (shorter: readonly string[], longer: readonly string[]): boolean =>
  shorter.length <= longer.length && shorter.every((id, i) => id === longer[i]);

/** The path to open to take a group apart a level, or nothing when opening it would change nothing. */
function opening(c: Context, bucket: Bucket): readonly string[] | undefined {
  const { index } = c.source;
  const first = bucket.ids[0] as string;
  const path =
    bucket.container === ROOT
      ? chainOf(index, first).slice(0, 1)
      : [...chainOf(index, bucket.container), bucket.container];
  return path.length === 0 || prefixOf(path, c.opened) ? undefined : path;
}

/** What the equipment is, when it is all one kind; and the commonest kind, for the glyph of a mixed group. */
function kindsOf(
  c: Context,
  ids: readonly string[],
): { same: TopoKind | undefined; most: TopoKind } {
  const tally = new Map<TopoKind, number>();
  for (const id of ids) {
    const kind = c.shape.kindOf.get(id) as TopoKind;
    tally.set(kind, (tally.get(kind) ?? 0) + 1);
  }
  const [most] = [...tally].sort((a, b) => b[1] - a[1])[0] as [TopoKind, number];
  return { same: tally.size === 1 ? most : undefined, most };
}

function groupTile(c: Context, stage: number, bucket: Bucket): Tile {
  const { index } = c.source;
  const label = c.shape.stages[stage]?.label ?? "";
  const servers = serversReaching(c.source, c.shape, bucket.ids);
  const state: TopoState =
    bucket.cls === "fault" || bucket.cls === "alarm" || bucket.cls === "impact" ? bucket.cls : "ok";
  const where = bucket.container === ROOT ? undefined : index.find(bucket.container)?.name;
  const { same, most } = kindsOf(c, bucket.ids);
  const open = opening(c, bucket);
  return {
    id: `g|${c.shape.stages[stage]?.id}|${bucket.container}|${bucket.cls}`,
    stage,
    kind: most,
    group: true,
    name: groupName(bucket.cls, c.layer, same, label, bucket.ids.length),
    // Where it is folded under, and how many servers stand on it (a group of servers says that in its name).
    line: [where, servers > 0 && same !== "server" ? `서버 ${num(servers)}대` : undefined]
      .filter(Boolean)
      .join(" · "),
    state,
    touched: bucket.cls === "touch",
    count: bucket.ids.length,
    servers,
    bar: [],
    ...(open ? { open } : {}),
    ...(where ? { where } : {}),
    focus: false,
  };
}

interface StageTiles {
  readonly tiles: Tile[];
  /** Which tile each piece of equipment of the stage is drawn in. */
  readonly tileOf: Map<string, string>;
}

function stageTiles(c: Context, stage: number, room: number, pins: readonly string[]): StageTiles {
  const members = c.shape.members[stage] as readonly string[];
  const tiles: Tile[] = [];
  const tileOf = new Map<string, string>();
  const stand = members.length <= SMALL_STAGE ? members : pins.slice(0, room - CLASSES);
  const standing = new Set(stand);
  for (const id of stand) {
    tiles.push(singleTile(c, stage, id));
    tileOf.set(id, id);
  }
  const loose = standing.size === members.length ? [] : members.filter((id) => !standing.has(id));
  const { buckets } = fit(c.source.index, c.status, loose, c.opened, room - standing.size);
  for (const bucket of buckets.values()) {
    const tile =
      bucket.ids.length === 1
        ? singleTile(c, stage, bucket.ids[0] as string)
        : groupTile(c, stage, bucket);
    tiles.push(tile);
    for (const id of bucket.ids) tileOf.set(id, tile.id);
  }
  return { tiles, tileOf };
}

/** The worst state first; what the agents touch comes after the broken and the alarming, before the quiet rest. */
const rank = (t: Tile): number =>
  t.state === "ok" && t.touched ? SEVERITY.touch : SEVERITY[t.state];

function crumbsOf(source: TopologySource, path: readonly string[]): Crumb[] {
  return path.flatMap((id) => {
    const e = source.index.find(id);
    return e ? [{ id, name: e.name }] : [];
  });
}

/** Fold a layer of the world into the board to draw. */
export function fold(source: TopologySource, options: FoldOptions, known?: Impact): Board {
  const { index } = source;
  const shape = layerShape(index, options.layer);
  const status = statusOf(source, known ?? impactOf(source));
  const opened = (options.path ?? []).filter((id) => index.has(id));
  const stages = shape.stages;
  const focus = options.focus && shape.stageOf.has(options.focus.id) ? options.focus.id : undefined;
  const c: Context = { source, shape, status, layer: options.layer, opened, focus };
  const limit = Math.min(options.limit ?? MAX_TILES, MAX_TILES);
  const room = Math.max(CLASSES + 1, Math.floor(limit / Math.max(1, stages.length)));
  const pins = pinsOf(source, shape, status, options.focus);
  const tileOf = new Map<string, string>();
  const bare: Tile[] = [];
  stages.forEach((_, stage) => {
    const one = stageTiles(c, stage, room, pins[stage] as readonly string[]);
    bare.push(...one.tiles);
    for (const [id, tile] of one.tileOf) tileOf.set(id, tile);
  });
  const { edges, bars } = join(options.layer, shape, bare, tileOf);
  const tiles = bare
    .map((t) => ({ ...t, bar: bars.get(t.id) ?? [[1, t.state] as const] }))
    .sort(
      (a, b) =>
        a.stage - b.stage || rank(a) - rank(b) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
    );
  const entities = shape.members.reduce((n, list) => n + list.length, 0);
  return {
    layer: options.layer,
    stages,
    tiles,
    edges,
    path: crumbsOf(source, opened),
    stats: { tiles: tiles.length, entities, folded: entities - tiles.length },
  };
}
