/**
 * Which equipment is drawn on its own whatever the fold says: the one the viewer picked and the ones around it
 * (what it leans on, or what leans on it, a few steps out), then what is broken, what is alarming and what the
 * agents are touching. The list of each stage is in that order, so when a stage has room for only some of them
 * the picked one and the broken ones win.
 */

import type { Focus } from "./fold";
import type { LayerShape, Status } from "./layers";
import type { TopologySource } from "./types";

const RANK = { focus: 0, fault: 1, alarm: 2, touch: 3, near: 4 } as const;
type Rank = (typeof RANK)[keyof typeof RANK];

/** How many neighbours to follow at most: a pipe that fans out to thousands is not a neighbourhood. */
const NEAR_LIMIT = 200;
/** How many neighbours stand on their own in one stage: the nearest few, so that the neighbourhood can be read. */
const NEAR_PER_STAGE = 6;

const LEANERS = new Set(["rack", "server", "storage", "vm", "cluster"]);

/** The equipment within a few steps of the picked one, in the direction asked for. */
function neighbours(shape: LayerShape, focus: Focus): string[] {
  const kind = shape.kindOf.get(focus.id);
  const up = focus.direction === "up" || (focus.direction !== "down" && LEANERS.has(kind ?? ""));
  const next = up ? shape.suppliers : shape.consumers;
  const seen = new Set<string>([focus.id]);
  let frontier = [focus.id];
  for (let hop = 0; hop < (focus.hops ?? 2); hop++) {
    const after: string[] = [];
    for (const id of frontier)
      for (const n of next.get(id) ?? []) {
        if (seen.has(n) || seen.size > NEAR_LIMIT) continue;
        seen.add(n);
        after.push(n);
      }
    frontier = after;
  }
  seen.delete(focus.id);
  return [...seen];
}

/** For each stage, the equipment to draw on its own, most important first. */
export function pinsOf(
  source: TopologySource,
  shape: LayerShape,
  status: Status,
  focus: Focus | undefined,
): string[][] {
  const ranks = shape.stages.map(() => new Map<string, Rank>());
  const add = (id: string, rank: Rank) => {
    const at = shape.stageOf.get(id);
    if (at === undefined) return;
    const list = ranks[at] as Map<string, Rank>;
    const had = list.get(id);
    if (had === undefined || rank < had) list.set(id, rank);
  };
  if (focus && shape.stageOf.has(focus.id)) {
    add(focus.id, RANK.focus);
    const taken = new Map<number, number>();
    for (const id of neighbours(shape, focus)) {
      const stage = shape.stageOf.get(id) as number;
      if ((taken.get(stage) ?? 0) >= NEAR_PER_STAGE) continue;
      taken.set(stage, (taken.get(stage) ?? 0) + 1);
      add(id, RANK.near);
    }
  }
  for (const id of status.impact.causes.faulted) add(id, RANK.fault);
  for (const id of status.impact.causes.alarmed) add(id, RANK.alarm);
  for (const id of source.touched ?? []) add(id, RANK.touch);
  const { index } = source;
  return ranks.map((list) =>
    [...list.entries()]
      .sort(([a, ra], [b, rb]) => ra - rb || (index.entity(a).name < index.entity(b).name ? -1 : 1))
      .map(([id]) => id),
  );
}
