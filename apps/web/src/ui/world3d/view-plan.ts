/** Where a point of the builder's plan shows on the canvas (REQ-006): the plan's own floor, seen through the camera. */
import * as THREE from "three";
import { world3d } from "../../logic";

export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
  readonly visible: boolean;
}

/** A plan point (x, height above its floor, plan y) in pixels of a canvas of this size; `visible` is false behind the camera. */
export function screenOfPlan(
  frame: world3d.PlanFrame,
  camera: THREE.Camera,
  size: { readonly width: number; readonly height: number },
  p: { readonly x: number; readonly y: number; readonly z: number },
): ScreenPoint {
  const at = world3d.toSite(frame, { x: p.x, y: p.z });
  const v = new THREE.Vector3(at.x, frame.y + p.y, at.z).project(camera);
  return {
    x: ((v.x + 1) / 2) * size.width,
    y: ((1 - v.y) / 2) * size.height,
    visible: v.z > -1 && v.z < 1,
  };
}
