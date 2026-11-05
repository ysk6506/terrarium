/**
 * One rack close up (REQ-006, REQ-045, REQ-049): the frame with its door swung open, and every device
 * in it unit by unit — a server with the front its maker gave it, switches with their ports, storage
 * with drive bays, a PDU down the side. An immersion tank shows its coolant with the servers standing
 * in it. Devices can be picked one by one through unseen boxes.
 */
import * as THREE from "three";
import { world3d } from "../../logic";
import { Baker } from "./baker";
import type { Engine } from "./engine";
import { proxyBox } from "./layer";
import type { Kit } from "./parts";

type Device = world3d.Device;
type RackScene = world3d.RackScene;

const { RACK_BASE_M } = world3d;
const POST_M = 0.045;

export interface RackLayer {
  readonly group: THREE.Group;
  readonly pickables: THREE.Object3D[];
  /** Where a device's front is, in the rack's own frame. */
  frontOf(deviceId: string): THREE.Vector3 | undefined;
  dispose(): void;
}

function frame(k: Kit, scene: RackScene): void {
  const { b, m } = k;
  const { w, d, h } = scene.kind;
  b.box(m.dark, { x: 0, z: 0, w, d, h: RACK_BASE_M, round: 0.03 });
  b.box(m.dark, { x: 0, z: 0, w, d, h: 0.05, y: h - 0.05, round: 0.03 });
  for (const sx of [-1, 1])
    for (const sz of [-1, 1])
      b.box(m.dark, {
        x: sx * (w / 2 - POST_M / 2),
        z: sz * (d / 2 - POST_M / 2),
        w: POST_M,
        d: POST_M,
        h: h - RACK_BASE_M,
        y: RACK_BASE_M,
      });
  for (const sx of [-1, 1])
    b.box(m.steel, {
      x: sx * (w / 2 - 0.085),
      z: d / 2 - 0.07,
      w: 0.02,
      d: 0.03,
      h: h - 0.3,
      y: 0.15,
      shadow: false,
    });
}

/** The perforated front door, swung open about its hinge. */
function door(k: Kit, scene: RackScene, into: THREE.Group): void {
  const { w, d, h } = scene.kind;
  const geo = new THREE.BoxGeometry(w, h - 0.12, 0.03);
  geo.translate(w / 2, 0, 0);
  const mesh = new THREE.Mesh(geo, [
    k.m.rackSkin,
    k.m.rackSkin,
    k.m.rackSkin,
    k.m.rackSkin,
    k.m.rackFace,
    k.m.rackSkin,
  ]);
  mesh.position.set(-w / 2, h / 2, d / 2 + 0.02);
  mesh.rotation.y = -Math.PI * 0.62;
  mesh.castShadow = true;
  const colour = new THREE.Color(scene.kind.look.body);
  mesh.material = (mesh.material as THREE.Material[]).map((mat) => {
    const c = (mat as THREE.MeshStandardMaterial).clone();
    c.color.copy(colour);
    return c;
  });
  into.add(mesh);
}

function pduOf(k: Kit, scene: RackScene, d: Device, n: number): void {
  const { b, m } = k;
  const { w, d: depth, h } = scene.kind;
  const x = (n % 2 === 0 ? -1 : 1) * (w / 2 - 0.1);
  b.box(m.paintOf(d.look), {
    x,
    z: -depth / 2 + 0.1,
    w: 0.05,
    d: 0.05,
    h: h * 0.7,
    y: h * 0.12,
    round: 0.01,
  });
  for (let i = 0; i < 12; i++)
    b.box(m.led, {
      x,
      z: -depth / 2 + 0.13,
      w: 0.03,
      d: 0.01,
      h: 0.03,
      y: h * 0.16 + (i * (h * 0.6)) / 12,
      shadow: false,
    });
}

/** A device in its units: the body in the maker's paint with the maker's front plate. */
function deviceBox(k: Kit, scene: RackScene, dev: Device): void {
  const { b, m } = k;
  const { w, d, unitM } = scene.kind;
  const width = Math.min(0.482, w - 0.1);
  const depth = d * 0.82;
  const height = Math.max(1, dev.units) * unitM - 0.005;
  const y = RACK_BASE_M + (dev.u - 1) * unitM + 0.0025;
  const z = d / 2 - 0.08 - depth / 2;
  b.box(m.paintOf(dev.look), { x: 0, z, w: width, d: depth, h: height, y, round: 0.004 });
  b.box(m.face(dev.look, dev.units), {
    x: 0,
    z: z + depth / 2 + 0.002,
    w: width,
    d: 0.006,
    h: height,
    y,
    shadow: false,
  });
}

/** Servers standing in the coolant of a tank. */
function tank(k: Kit, scene: RackScene): void {
  const { b, m } = k;
  const { w, d, h } = scene.kind;
  const t = 0.07;
  b.box(m.dark, { x: 0, z: 0, w: w + 0.04, d: d + 0.04, h: 0.12, round: 0.02 });
  for (const [x, z, bw, bd] of [
    [0, d / 2 - t / 2, w, t],
    [0, -d / 2 + t / 2, w, t],
    [w / 2 - t / 2, 0, t, d],
    [-w / 2 + t / 2, 0, t, d],
  ] as const)
    b.box(m.tankShell, { x, z, w: bw, d: bd, h: h - 0.12, y: 0.12, round: 0.02 });
  b.box(m.fluid, { x: 0, z: 0, w: w - t * 2, d: d - t * 2, h: h * 0.78, y: 0.14, shadow: false });
  const n = Math.max(1, Math.min(scene.devices.length, 24));
  const pitch = (d - t * 2) / n;
  for (let i = 0; i < n; i++) {
    const dev = scene.devices[i] as Device;
    const z = -d / 2 + t + pitch * (i + 0.5);
    b.box(m.paintOf(dev.look), {
      x: 0,
      z,
      w: w - t * 2 - 0.1,
      d: pitch * 0.62,
      h: h * 0.74,
      y: 0.2,
      round: 0.01,
    });
    b.box(m.dark, { x: 0, z, w: 0.25, d: pitch * 0.4, h: 0.05, y: h * 0.74 + 0.2, round: 0.01 });
  }
}

export function buildRackLayer(engine: Engine, scene: RackScene): RackLayer {
  const k: Kit = { b: new Baker(), m: engine.mats };
  const group = new THREE.Group();
  const pickables: THREE.Object3D[] = [];
  const fronts = new Map<string, THREE.Vector3>();
  if (scene.kind.form === "tank") tank(k, scene);
  else {
    frame(k, scene);
    let pdus = 0;
    for (const dev of scene.devices) {
      // A vertical PDU hangs at the back; a power shelf of an ORv3 rack is a box in its units like the rest.
      const vertical = dev.kind === "pdu" && dev.units === 0;
      if (vertical) pduOf(k, scene, dev, pdus++);
      else deviceBox(k, scene, dev);
      if (vertical) continue;
      const height = Math.max(1, dev.units) * scene.kind.unitM;
      const y = RACK_BASE_M + (dev.u - 1) * scene.kind.unitM + height / 2;
      const front = new THREE.Vector3(0, y, scene.kind.d / 2);
      fronts.set(dev.id, front);
      pickables.push(
        proxyBox(
          { kind: "device", id: dev.id },
          [0, y, scene.kind.d / 2 - 0.3],
          [Math.min(0.5, scene.kind.w), height, 0.7],
        ),
      );
    }
    door(k, scene, group);
  }
  group.add(k.b.bake(), ...pickables);
  return {
    group,
    pickables,
    frontOf: (id) => fronts.get(id),
    dispose: () => {
      group.removeFromParent();
      group.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    },
  };
}
