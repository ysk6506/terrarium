/**
 * What is drawn over the 3D picture while building (REQ-006, REQ-036): an outline round everything
 * selected and the ghost of what the next click would put down. Both are boxes in the level's plan
 * (x to the right, z toward the viewer, y up from the plan's floor), so they follow the plan's frame.
 */
import type { Scene } from "../builder/scene";
import { ROOM_HEIGHT_M } from "./room";

/** A box by its centre and size, metres. */
export interface PlanBox {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;
  readonly h: number;
  readonly d: number;
}

/** The ghost of something about to be placed: its corner on the plan, its size, and whether it may go there. */
export interface PlanGhost {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly d: number;
  readonly h: number;
  readonly ok: boolean;
}

/** A room is outlined as high as its walls, not as thin as the slab it is drawn as on a plan; a parcel as high as its stakes. */
const OUTLINE_HEIGHT: Readonly<Record<string, number>> = { room: ROOM_HEIGHT_M, parcel: 6 };

/** The boxes to outline for a selection: where each selected thing stands in the level's plan. */
export function outlinesOf(scene: Scene, ids: readonly string[]): PlanBox[] {
  const out: PlanBox[] = [];
  for (const id of ids) {
    if (scene.outlines.has(id)) continue;
    const at = scene.where.get(id);
    const group = at && scene.groups.find((g) => g.key === at.group);
    if (!at || !group) continue;
    const i = at.index * 6;
    const b = group.boxes;
    const h = OUTLINE_HEIGHT[group.key] ?? (b[i + 4] as number);
    out.push({
      x: b[i] as number,
      y: h / 2,
      z: b[i + 2] as number,
      w: b[i + 3] as number,
      h,
      d: b[i + 5] as number,
    });
  }
  return out;
}

/** A ghost as a box in the plan. */
export const ghostBox = (g: PlanGhost): PlanBox => ({
  x: g.x + g.w / 2,
  y: g.h / 2,
  z: g.y + g.d / 2,
  w: g.w,
  h: g.h,
  d: g.d,
});

/** A closed outline on the plan, drawn as a wall of this height: a room, whatever its shape. */
export interface PlanShape {
  readonly points: ReadonlyArray<{ readonly x: number; readonly z: number }>;
  readonly h: number;
}

/** The outlines to draw for a selection: the rooms in it, along their real walls. */
export function shapesOf(scene: Scene, ids: readonly string[]): PlanShape[] {
  const out: PlanShape[] = [];
  for (const id of ids) {
    const corners = scene.outlines.get(id);
    if (corners) out.push({ points: corners.map((c) => ({ x: c.x, z: c.y })), h: ROOM_HEIGHT_M });
  }
  return out;
}

/** A handle on the plan: where it sits, how big it is drawn, and what it does when dragged. */
export interface PlanHandle {
  readonly x: number;
  readonly z: number;
  readonly size: number;
  readonly kind: "edge" | "attach";
  /** Which way the side faces, for the plus. */
  readonly side: "left" | "right" | "top" | "bottom";
}
