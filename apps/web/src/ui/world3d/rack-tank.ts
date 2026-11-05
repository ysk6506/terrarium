/** An immersion tank: servers standing in the coolant of a tub, nothing to pick or turn (REQ-044). */
import * as THREE from "three";
import type { world3d } from "../../logic";
import { Baker } from "./baker";
import type { Engine } from "./engine";
import type { Kit } from "./parts";
import type { RackLayer } from "./rack-layer";

type Device = world3d.Device;
type RackScene = world3d.RackScene;

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

export function tankScene(engine: Engine, scene: RackScene): RackLayer {
  const k: Kit = { b: new Baker(), m: engine.mats };
  tank(k, scene);
  const group = new THREE.Group();
  group.add(k.b.bake());
  return {
    group,
    pickables: [],
    state: { selected: undefined, rear: false },
    frontOf: () => undefined,
    pick: () => {},
    setCondition: () => {},
    clear: () => {},
    dispose: () => {
      group.removeFromParent();
      group.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    },
  };
}
