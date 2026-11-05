/**
 * Unseen boxes that stand for the containments and the equipment of one room, so the room being
 * edited can be clicked part by part (REQ-006, REQ-036). They are made when a room is opened and
 * dropped when it closes: a hall with hundreds of containments does not carry them all the time.
 */
import * as THREE from "three";
import type { world3d } from "../../logic";
import type { PickTag } from "./layer";

const POD_H_M = 2.3;
const INVISIBLE = new THREE.MeshBasicMaterial({ visible: false });
/** One unit cube shared by every proxy; each is scaled to its thing. */
const UNIT = new THREE.BoxGeometry(1, 1, 1);

function proxy(
  tag: PickTag,
  at: [number, number, number],
  size: [number, number, number],
  rot = 0,
) {
  const mesh = new THREE.Mesh(UNIT, INVISIBLE);
  mesh.position.set(...at);
  mesh.scale.set(...size);
  mesh.rotation.y = rot;
  mesh.userData.pick = tag;
  mesh.visible = false;
  return mesh;
}

/** Proxies in the room's own frame, gathered in a group the caller places at the room's corner. */
export function roomPicks(scene: world3d.RoomScene): THREE.Group {
  const group = new THREE.Group();
  for (const pod of scene.pods) {
    const e = pod.enclosure;
    group.add(
      proxy(
        { kind: "containment", id: pod.id },
        [(e.x0 + e.x1) / 2, scene.floorY + POD_H_M / 2, (e.z0 + e.z1) / 2],
        [e.x1 - e.x0, POD_H_M, e.z1 - e.z0],
      ),
    );
  }
  for (const e of scene.equipment)
    group.add(
      proxy({ kind: "equipment", id: e.id }, [e.x, e.oy + e.h / 2, e.z], [e.w, e.h, e.d], e.rot),
    );
  return group;
}
