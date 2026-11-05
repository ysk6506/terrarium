/**
 * Folding one stage of a layer: which pieces of equipment stand alone and which fall into groups. A group is the
 * equipment of one kind of trouble (or none) under one container. The containers that the viewer has opened, from
 * the site down, split the groups a level further; what is not on that path stays folded at the level where the path
 * leaves it. When a stage still has more tiles than it may, the path is cut back from its end until it fits, and in
 * the end everything of one class is one group: so the count of tiles has a ceiling that does not depend on the world.
 */
import type { BlueprintIndex } from "@terrarium/core/world";
import type { Status } from "./layers";
import { chainOf } from "./layers";
import type { TileClass } from "./types";

/** The container of everything, above the site. */
export const ROOT = "";

/** The most groups one stage can need at the coarsest fold: one for each class. */
export const CLASSES = 5;

export interface Bucket {
  readonly cls: TileClass;
  /** The container the members are folded under (`ROOT` for all), or the member itself when it stands alone. */
  readonly container: string;
  readonly ids: string[];
}

export const classOf = (status: Status, id: string): TileClass => {
  const state = status.stateOf(id);
  if (state === "fault" || state === "alarm") return state;
  if (status.touched(id)) return "touch";
  return state === "impact" ? "impact" : "ok";
};

/** The container a piece of equipment is folded under, given the opened path (`undefined`: nothing opened, all one). */
export function containerOf(
  chain: readonly string[],
  id: string,
  path: readonly string[] | undefined,
  opened: ReadonlySet<string>,
): string {
  if (path === undefined) return ROOT;
  if (opened.has(id)) return id;
  let m = 0;
  while (m < path.length && m < chain.length && chain[m] === path[m]) m++;
  if (m === path.length && m === chain.length) return id;
  return chain[Math.min(m, chain.length - 1)] ?? ROOT;
}

/** Sort the loose equipment of a stage into buckets by class and container. */
export function bucketsOf(
  index: BlueprintIndex,
  status: Status,
  loose: readonly string[],
  path: readonly string[] | undefined,
): Map<string, Bucket> {
  const opened = new Set(path ?? []);
  const out = new Map<string, Bucket>();
  for (const id of loose) {
    const cls = classOf(status, id);
    const container = containerOf(chainOf(index, id), id, path, opened);
    const key = `${cls}|${container}`;
    const bucket = out.get(key);
    if (bucket) bucket.ids.push(id);
    else out.set(key, { cls, container, ids: [id] });
  }
  return out;
}

export interface Fitted {
  readonly buckets: Map<string, Bucket>;
  /** The path the stage was folded at: the opened one, or a shorter one when it did not fit. */
  readonly path: readonly string[] | undefined;
}

/** Fold the loose equipment of a stage so that it and the standing-alone tiles together are at most `room`. */
export function fit(
  index: BlueprintIndex,
  status: Status,
  loose: readonly string[],
  opened: readonly string[],
  room: number,
): Fitted {
  for (let keep = opened.length; keep >= 0; keep--) {
    const path = opened.slice(0, keep);
    const buckets = bucketsOf(index, status, loose, path);
    if (buckets.size <= room) return { buckets, path };
  }
  return { buckets: bucketsOf(index, status, loose, undefined), path: undefined };
}
