/** What a built part of the scene gives back: its objects, what can be clicked, and how to let go of it. */
import * as THREE from "three";
import { disposeGeometry } from "./baker";

/** What a click on an object means. */
export interface PickTag {
  readonly kind:
    | "building"
    | "yard"
    | "parcel"
    | "room"
    | "containment"
    | "equipment"
    | "rack"
    | "device";
  readonly id: string;
}

export interface Layer {
  readonly group: THREE.Group;
  /** Objects a ray may hit; each carries its tag in `userData.pick`. */
  readonly pickables: readonly THREE.Object3D[];
  dispose(): void;
}

const INVISIBLE = new THREE.MeshBasicMaterial({ visible: false });

/** An unseen box that stands for a thing when picking, so a click does not depend on its many small parts. */
export function proxyBox(
  tag: PickTag,
  centre: readonly [number, number, number],
  size: readonly [number, number, number],
  rot = 0,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), INVISIBLE);
  mesh.position.set(...centre);
  mesh.rotation.y = rot;
  mesh.userData.pick = tag;
  mesh.visible = false;
  return mesh;
}

export function makeLayer(group: THREE.Group, pickables: readonly THREE.Object3D[]): Layer {
  return {
    group,
    pickables,
    dispose: () => {
      group.removeFromParent();
      disposeGeometry(group);
    },
  };
}

/** The tag a picked object carries, looking up through its parents. */
export function pickOf(object: THREE.Object3D | null): PickTag | undefined {
  for (let o: THREE.Object3D | null = object; o; o = o.parent) {
    const tag = o.userData.pick as PickTag | undefined;
    if (tag) return tag;
  }
  return undefined;
}
