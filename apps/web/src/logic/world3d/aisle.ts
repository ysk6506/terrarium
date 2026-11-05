/**
 * Looking into a containment (REQ-006, REQ-074, ADR-0101, feedback 8): where the camera stands inside the closed-in
 * aisle, which way it looks, the line a person walks along in it, and what the breadcrumb calls it. Plain numbers,
 * so they are tested without a browser; `ui/world3d/view.ts` flies the camera there and the building layer takes
 * the roof and doors away.
 */

import type { Box3, Pose } from "./camera";
import type { Aisle } from "./crew-route";
import type { Bounds, Pt } from "./plan";
import type { Pod } from "./room";

/** Height of the camera over the floor of the aisle, metres: a person's eyes. */
export const EYE_M = 1.62;
/** Height of the point looked at, metres. */
export const LOOK_M = 1.15;
/** Seconds the camera takes to walk in, and the same to walk out. */
export const WALK_IN_S = 0.6;
/** A person walking the aisle keeps this far from its ends, metres. */
const END_M = 0.5;

/** Which way an aisle runs. */
export const runsAlongX = (e: Bounds): boolean => e.x1 - e.x0 >= e.z1 - e.z0;

/** The line a person walks in the aisle: its middle, from end to end (pulled in at both ends). */
export function aisleLine(pod: Pick<Pod, "enclosure">): Aisle {
  const e = pod.enclosure;
  if (runsAlongX(e)) {
    const z = (e.z0 + e.z1) / 2;
    const pad = Math.min(END_M, (e.x1 - e.x0) / 4);
    return { a: { x: e.x0 + pad, z }, b: { x: e.x1 - pad, z } };
  }
  const x = (e.x0 + e.x1) / 2;
  const pad = Math.min(END_M, (e.z1 - e.z0) / 4);
  return { a: { x, z: e.z0 + pad }, b: { x, z: e.z1 - pad } };
}

/** The camera inside the aisle, near one end and looking along it; the point looked at is the middle at chest height. */
export function aislePose(box: Box3): Pose {
  const along = box.x1 - box.x0 >= box.z1 - box.z0;
  const length = along ? box.x1 - box.x0 : box.z1 - box.z0;
  // Near an end but always inside, even in a short aisle.
  const stand = Math.min(6, length / 2 - 0.1, Math.max(1.1, length * 0.42));
  const rise = EYE_M - LOOK_M;
  return {
    target: [(box.x0 + box.x1) / 2, box.y0 + LOOK_M, (box.z0 + box.z1) / 2],
    distance: stand,
    yaw: along ? Math.PI / 2 : 0,
    pitch: Math.atan2(rise, stand),
  };
}

/** Whether a point (room frame) is inside the aisle. */
export const inside = (e: Bounds, p: Pt): boolean =>
  p.x >= e.x0 && p.x <= e.x1 && p.z >= e.z0 && p.z <= e.z1;

/** What the breadcrumb calls the aisle you are in: "컨테인먼트 A-1 안". */
export function insideLabel(podName: string): string {
  return `${podName.includes("컨테인먼트") ? podName : `컨테인먼트 ${podName}`} 안`;
}

/** The sentence under the breadcrumb that tells how to get out. */
export const LEAVE_HINT = "Esc를 누르거나 '복도 나가기'를 누르면 나가요";
