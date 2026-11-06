/**
 * What the topology view reads of the builder's world. With no "돌려 보기" yet, the world is as it was built: nothing
 * broken, nothing alarming. After a run it is the world the run left, at the moment of the time bar: the alarms
 * and the temperatures of that frame, over the final state of the rest.
 */
import type { Catalog } from "@terrarium/core/catalog";
import { type Earlier, restingSource, type TopologySource } from "@terrarium/core/topology";
import type { Alarm, BlueprintIndex, EntityState } from "@terrarium/core/world";
import type { Preview, PreviewFrame } from "../builder/preview";

const alarmOf = (a: PreviewFrame["alarms"][number]): Alarm => ({
  id: `${a.entityId}:${a.severity}`,
  entityId: a.entityId,
  code: "frame",
  severity: a.severity,
  message: "",
  since: a.since,
});

/** The rack temperatures of a frame, for telling which way they are going. */
const earlierOf = (frame: PreviewFrame): Earlier => ({
  t: frame.t,
  inletC: new Map([...frame.racks].map(([id, r]) => [id, r.inletC])),
});

/** What one frame of the run says over the final state of the world. */
function stateAt(world: Preview["world"], frame: PreviewFrame, id: string): EntityState {
  const s = world.stateOf(id);
  if (s.kind === "rack") {
    const r = frame.racks.get(id);
    return r ? { ...s, inletC: r.inletC, outletC: r.outletC } : s;
  }
  if (s.kind === "cooling_unit") {
    const u = frame.units.get(id);
    return u ? { ...s, ...u } : s;
  }
  if (s.kind === "room") return { ...s, ambientC: frame.rooms.get(id) ?? s.ambientC };
  return s;
}

/** The source for a frame of a run (the first frame is before the cooling units were stopped, so no fault yet). */
function frameSource(preview: Preview, at: number): TopologySource {
  const { world, frames } = preview;
  const frame = frames[at] as PreviewFrame;
  const before = at > 0 ? frames[at - 1] : undefined;
  return {
    index: world.index,
    time: () => frame.t,
    stateOf: (id) => stateAt(world, frame, id),
    faults: () => (at === 0 ? [] : world.faults()),
    alarms: () => frame.alarms.map(alarmOf),
    linkUp: (id) => world.linkUp(id),
    ...(before ? { earlier: earlierOf(before) } : {}),
  };
}

/** The frame of the time bar: the last one until somebody drags it. */
export const frameOf = (preview: Preview, at: number | undefined): number =>
  Math.max(0, Math.min(at ?? preview.frames.length - 1, preview.frames.length - 1));

export function sourceOf(
  index: BlueprintIndex,
  catalog: Catalog,
  preview: Preview | undefined,
  at: number | undefined,
): TopologySource {
  if (!preview || preview.frames.length === 0) return restingSource(index, catalog);
  return frameSource(preview, frameOf(preview, at));
}
