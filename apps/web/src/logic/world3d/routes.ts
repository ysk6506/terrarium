/**
 * The lines a layer draws in a room: which unit cools which rack, what feeds what, which switch talks
 * to which. Only what lies inside the room is drawn; a line that leaves the room is counted instead.
 */
import type { BlueprintIndex, Entity, LinkKind } from "@terrarium/core/world";
import type { RoomScene } from "./room";

export interface Line {
  readonly a: readonly [number, number, number];
  readonly b: readonly [number, number, number];
  readonly from: string;
  readonly to: string;
}

export interface Routes {
  readonly lines: readonly Line[];
  /** Links that go to something outside the room. */
  readonly leaving: number;
}

export const MAX_LINES = 4000;

type Spot = readonly [number, number, number];

/** Where each rack and machine in a room has its top: the point lines attach to. */
function tops(scene: RoomScene): Map<string, Spot> {
  const at = new Map<string, Spot>();
  for (const set of scene.sets) {
    for (let i = 0; i < set.ids.length; i++) {
      at.set(set.ids[i] as string, [
        set.at[i * 4] as number,
        (set.at[i * 4 + 1] as number) + set.kind.h,
        set.at[i * 4 + 2] as number,
      ]);
    }
  }
  for (const e of scene.equipment) at.set(e.id, [e.x, e.oy + e.h, e.z]);
  return at;
}

/** Entities this one depends on through links of one kind, following the chain a few hops. */
function reach(
  index: BlueprintIndex,
  starts: readonly string[],
  kind: LinkKind,
  stopAt: ReadonlyMap<string, Spot>,
  hops = 4,
): { found: string[]; outside: number } {
  const seen = new Set(starts);
  const found = new Set<string>();
  let outside = 0;
  let frontier = [...starts];
  for (let hop = 0; hop < hops && frontier.length > 0; hop++) {
    const next: string[] = [];
    for (const id of frontier)
      for (const link of index.outgoing(id, kind)) {
        if (seen.has(link.to)) continue;
        seen.add(link.to);
        if (stopAt.has(link.to)) found.add(link.to);
        else if (index.find(link.to)?.kind === "pdu" || hop < hops - 1) next.push(link.to);
        else outside++;
      }
    frontier = next;
  }
  return { found: [...found], outside };
}

/** The entities a rack hangs its links on: itself, its machines, its PDUs and switches. */
function members(index: BlueprintIndex, rack: Entity): string[] {
  return [rack.id, ...index.childrenOf(rack.id).map((c) => c.id)];
}

export function powerRoutes(index: BlueprintIndex, scene: RoomScene): Routes {
  const at = tops(scene);
  const feeds = new Map(
    scene.equipment.filter((e) => e.style !== "busway").map((e) => [e.id, at.get(e.id) as Spot]),
  );
  return collect(index, scene, at, (rack) => reach(index, members(index, rack), "power", feeds));
}

export function coolingRoutes(index: BlueprintIndex, scene: RoomScene): Routes {
  const at = tops(scene);
  const cool = new Map(
    scene.equipment
      .filter((e) => e.style === "crah" || e.style === "inrow" || e.style === "cdu")
      .map((e) => [e.id, at.get(e.id) as Spot]),
  );
  return collect(index, scene, at, (rack) => reach(index, [rack.id], "cooling", cool, 2));
}

export function networkRoutes(index: BlueprintIndex, scene: RoomScene): Routes {
  const at = tops(scene);
  const lines: Line[] = [];
  let leaving = 0;
  const seen = new Set<string>();
  for (const set of scene.sets)
    for (const rackId of set.ids)
      for (const sw of index.childrenOf(rackId, "switch"))
        for (const link of index.outgoing(sw.id, "network")) {
          const peer = index.find(link.to);
          const peerRack = peer?.parentId && at.has(peer.parentId) ? peer.parentId : undefined;
          if (!peerRack) {
            leaving++;
            continue;
          }
          const key = [rackId, peerRack].sort().join("|");
          if (peerRack === rackId || seen.has(key) || lines.length >= MAX_LINES) continue;
          seen.add(key);
          lines.push({
            a: at.get(rackId) as Spot,
            b: at.get(peerRack) as Spot,
            from: rackId,
            to: peerRack,
          });
        }
  return { lines, leaving };
}

function collect(
  index: BlueprintIndex,
  scene: RoomScene,
  at: ReadonlyMap<string, Spot>,
  find: (rack: Entity) => { found: string[]; outside: number },
): Routes {
  const lines: Line[] = [];
  let leaving = 0;
  for (const set of scene.sets)
    for (const rackId of set.ids) {
      const rack = index.entity(rackId);
      const { found, outside } = find(rack);
      leaving += outside;
      for (const to of found)
        if (lines.length < MAX_LINES)
          lines.push({ a: at.get(rackId) as Spot, b: at.get(to) as Spot, from: rackId, to });
    }
  return { lines, leaving };
}
