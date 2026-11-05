/** Trees and parked cars, drawn as instanced meshes: thousands of them cost two draw calls each. */
import * as THREE from "three";
import type { world3d } from "../../logic";
import type { Materials } from "./materials";

const GREENS = ["#5da24e", "#6fae5a", "#85bd62"].map((c) => new THREE.Color(c));
const PAINTS = ["#d9dde2", "#2b3138", "#8b2f2f", "#34609a", "#ecebe5", "#6c737a"].map(
  (c) => new THREE.Color(c),
);

function shade(tint: number, into: THREE.Color): THREE.Color {
  const x = tint * (GREENS.length - 1);
  const i = Math.min(GREENS.length - 2, Math.floor(x));
  return into.lerpColors(GREENS[i] as THREE.Color, GREENS[i + 1] as THREE.Color, x - i);
}

export function trees(m: Materials, list: readonly world3d.Tree[]): THREE.Object3D[] {
  if (list.length === 0) return [];
  const trunks = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.25, 0.38, 3, 6),
    m.trunk,
    list.length,
  );
  const crowns = new THREE.InstancedMesh(
    new THREE.SphereGeometry(2.4, 12, 9),
    m.crown,
    list.length,
  );
  const o = new THREE.Object3D();
  const colour = new THREE.Color();
  list.forEach((t, i) => {
    o.position.set(t.x, 1.5 * t.scale, t.z);
    o.scale.setScalar(t.scale);
    o.updateMatrix();
    trunks.setMatrixAt(i, o.matrix);
    o.position.set(t.x, 4.6 * t.scale, t.z);
    o.scale.set(t.scale, t.scale * 1.15, t.scale);
    o.updateMatrix();
    crowns.setMatrixAt(i, o.matrix);
    crowns.setColorAt(i, shade(t.tint, colour));
  });
  for (const mesh of [trunks, crowns]) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
  }
  return [trunks, crowns];
}

export function cars(m: Materials, lots: readonly world3d.ParkingLot[]): THREE.Object3D[] {
  const all = lots.flatMap((l) => l.cars);
  if (all.length === 0) return [];
  const body = new THREE.InstancedMesh(new THREE.BoxGeometry(4.3, 0.95, 1.85), m.paint, all.length);
  const cabin = new THREE.InstancedMesh(new THREE.BoxGeometry(2.3, 0.8, 1.7), m.glass, all.length);
  const o = new THREE.Object3D();
  all.forEach((c, i) => {
    o.position.set(c.x, (c.y ?? 0) + 0.75, c.z);
    o.rotation.set(0, c.rot, 0);
    o.updateMatrix();
    body.setMatrixAt(i, o.matrix);
    body.setColorAt(i, PAINTS[c.paint % PAINTS.length] as THREE.Color);
    o.position.set(c.x - Math.cos(c.rot) * 0.2, (c.y ?? 0) + 1.55, c.z + Math.sin(c.rot) * 0.2);
    o.updateMatrix();
    cabin.setMatrixAt(i, o.matrix);
  });
  body.castShadow = true;
  body.frustumCulled = false;
  cabin.frustumCulled = false;
  return [body, cabin];
}
