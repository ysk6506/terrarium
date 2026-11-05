/**
 * The little people, animals and vehicles of the site, each drawn from a handful of boxes, balls and
 * cylinders with big heads and round shapes: toy-like on purpose. A model has two parts, the part that
 * takes the instance's own colour (paint, shirt, coat) and the fixed part (glass, wheels, faces).
 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { world3d } from "../../logic";

type LifeKind = world3d.LifeKind;

export interface Model {
  /** White parts: multiplied by the colour of each instance. */
  readonly tint: THREE.BufferGeometry;
  /** Parts with colours of their own. */
  readonly fixed: THREE.BufferGeometry;
  /** How much bigger than life it is drawn, so it can be seen from above. */
  readonly scale: number;
  /** The colours an instance may take. */
  readonly tones: readonly THREE.Color[];
}

class Parts {
  readonly tint: THREE.BufferGeometry[] = [];
  readonly fixed: THREE.BufferGeometry[] = [];

  private push(
    geo: THREE.BufferGeometry,
    color: string | undefined,
    x: number,
    y: number,
    z: number,
  ): void {
    const g = geo.index ? geo.toNonIndexed() : geo;
    g.translate(x, y, z);
    for (const n of Object.keys(g.attributes))
      if (n !== "position" && n !== "normal") g.deleteAttribute(n);
    const count = g.getAttribute("position").count;
    const c = new THREE.Color(color ?? "#ffffff");
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) c.toArray(colors, i * 3);
    g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    (color ? this.fixed : this.tint).push(g);
  }

  /** A box standing on y, centred on (x, z); `color` undefined means it takes the instance colour. */
  box(w: number, h: number, d: number, at: [number, number, number], color?: string): this {
    this.push(new THREE.BoxGeometry(w, h, d), color, at[0], at[1] + h / 2, at[2]);
    return this;
  }

  ball(r: number, at: [number, number, number], color?: string, squash = 1): this {
    const g = new THREE.SphereGeometry(r, 10, 8);
    g.scale(1, squash, 1);
    this.push(g, color, at[0], at[1], at[2]);
    return this;
  }

  /** A cylinder lying along x (`along` "x"), z, or standing (`up`). */
  cyl(
    r: number,
    length: number,
    at: [number, number, number],
    axis: "x" | "y" | "z",
    color?: string,
  ): this {
    const g = new THREE.CylinderGeometry(r, r, length, 14);
    if (axis === "x") g.rotateZ(Math.PI / 2);
    else if (axis === "z") g.rotateX(Math.PI / 2);
    this.push(g, color, at[0], at[1], at[2]);
    return this;
  }

  wheels(r: number, track: number, zs: readonly number[]): this {
    for (const z of zs)
      for (const s of [-1, 1]) this.cyl(r, 0.26, [s * track, r, z], "x", "#25282c");
    return this;
  }

  build(scale: number, tones: readonly string[]): Model {
    const merge = (list: THREE.BufferGeometry[]) =>
      list.length > 0
        ? (mergeGeometries(list, false) as THREE.BufferGeometry)
        : new THREE.BufferGeometry();
    return {
      tint: merge(this.tint),
      fixed: merge(this.fixed),
      scale,
      tones: tones.map((t) => new THREE.Color(t)),
    };
  }
}

/** Two small dark eyes, `gap` apart, at height y on the face plane z. */
function eyes(p: Parts, at: { y: number; z: number; gap: number; size: number }): void {
  for (const s of [-1, 1]) p.box(at.size, at.size, 0.03, [(s * at.gap) / 2, at.y, at.z], "#2b2b2b");
}

const GLASS = "#5a7a90";
const LAMP = "#ffe9a8";
const TAIL = "#d9453a";
const PAINTS = ["#e9ecef", "#2b3138", "#c0392b", "#2f5c9a", "#f2b134", "#6c737a", "#3fa59f"];

function lamps(p: Parts, w: number, front: number, back: number, y: number): void {
  for (const s of [-1, 1]) {
    p.box(0.28, 0.14, 0.05, [s * (w / 2 - 0.3), y, front], LAMP);
    p.box(0.28, 0.14, 0.05, [s * (w / 2 - 0.3), y, back], TAIL);
  }
}

function sedan(): Model {
  const p = new Parts();
  p.box(1.8, 0.62, 4.4, [0, 0.32, 0]).box(1.5, 0.52, 2.3, [0, 0.94, -0.2]);
  p.box(1.53, 0.4, 2.33, [0, 0.98, -0.2], GLASS).box(1.45, 0.07, 2.1, [0, 1.46, -0.2]);
  lamps(p, 1.8, 2.2, -2.2, 0.62);
  return p.wheels(0.34, 0.9, [-1.4, 1.4]).build(1.25, PAINTS);
}

function suv(): Model {
  const p = new Parts();
  p.box(1.9, 0.78, 4.6, [0, 0.34, 0]).box(1.78, 0.68, 3.1, [0, 1.1, -0.3]);
  p.box(1.8, 0.5, 3.12, [0, 1.16, -0.3], GLASS).box(1.7, 0.07, 3, [0, 1.78, -0.3]);
  lamps(p, 1.9, 2.3, -2.3, 0.7);
  return p.wheels(0.4, 0.95, [-1.5, 1.5]).build(1.25, PAINTS);
}

function van(): Model {
  const p = new Parts();
  p.box(1.95, 1.75, 4.9, [0, 0.38, 0]).box(1.9, 0.6, 0.06, [0, 1.15, 2.42], GLASS);
  p.box(1.98, 0.12, 4.9, [0, 1.2, 0], "#fbf8f1");
  lamps(p, 1.95, 2.45, -2.45, 0.75);
  return p.wheels(0.38, 0.95, [-1.6, 1.6]).build(1.25, PAINTS);
}

function truck(): Model {
  const p = new Parts();
  p.box(2.3, 1.9, 2, [0, 0.55, 2.6]).box(2.1, 0.8, 0.06, [0, 1.3, 3.6], GLASS);
  p.box(2.5, 2.5, 5.2, [0, 0.7, -1], "#f4efe4").box(2.52, 0.3, 5.22, [0, 1.7, -1], "#2a9dd8");
  p.box(2.2, 0.35, 8, [0, 0.35, 0.2], "#3a3f48");
  lamps(p, 2.3, 3.62, -3.62, 0.8);
  return p
    .wheels(0.5, 1.0, [-3, -1.4, 2.6])
    .build(1.2, ["#e5446d", "#2f5c9a", "#f2a516", "#1aa37a", "#e9ecef"]);
}

function tanker(): Model {
  const p = new Parts();
  p.box(2.3, 1.9, 2, [0, 0.55, 3.2]).box(2.1, 0.8, 0.06, [0, 1.3, 4.2], GLASS);
  p.cyl(1.15, 6.6, [0, 1.85, -0.7], "z", "#cfd6dc");
  p.cyl(1.17, 0.5, [0, 1.85, -2.4], "z", "#f2a516").cyl(1.17, 0.5, [0, 1.85, 1.0], "z", "#f2a516");
  p.cyl(0.35, 0.3, [0, 3.1, -0.7], "y", "#8d99ae").box(2.2, 0.35, 9, [0, 0.35, -0.3], "#3a3f48");
  lamps(p, 2.3, 4.22, -4.5, 0.8);
  return p
    .wheels(0.5, 1.0, [-3.4, -1.8, 3.2])
    .build(1.15, ["#e5446d", "#2f5c9a", "#e9ecef", "#f2a516"]);
}

const SKIN = "#f0c8a0";
const HAIR = "#3a2e28";

function person(): Model {
  const p = new Parts();
  p.box(0.16, 0.8, 0.2, [-0.12, 0, 0], "#3b4252").box(0.16, 0.8, 0.2, [0.12, 0, 0], "#3b4252");
  p.box(0.46, 0.62, 0.28, [0, 0.8, 0])
    .box(0.12, 0.55, 0.14, [-0.3, 0.82, 0])
    .box(0.12, 0.55, 0.14, [0.3, 0.82, 0]);
  p.ball(0.25, [0, 1.68, 0], SKIN).ball(0.26, [0, 1.76, -0.03], HAIR, 0.8);
  eyes(p, { y: 1.66, z: 0.24, gap: 0.18, size: 0.06 });
  return p.build(1.5, ["#e5446d", "#6a4be6", "#1aa37a", "#f2a516", "#2a9dd8", "#e8603c"]);
}

function cat(): Model {
  const p = new Parts();
  p.box(0.2, 0.2, 0.46, [0, 0.12, 0]).ball(0.14, [0, 0.3, 0.3]);
  p.box(0.05, 0.1, 0.04, [-0.08, 0.4, 0.3]).box(0.05, 0.1, 0.04, [0.08, 0.4, 0.3]);
  p.box(0.05, 0.05, 0.34, [0, 0.3, -0.38]).box(0.05, 0.26, 0.05, [0, 0.3, -0.54]);
  for (const x of [-0.07, 0.07]) for (const z of [-0.16, 0.16]) p.box(0.05, 0.14, 0.05, [x, 0, z]);
  eyes(p, { y: 0.31, z: 0.42, gap: 0.1, size: 0.035 });
  return p.build(2.6, ["#f0b27a", "#8d8d8d", "#3a3a3a", "#f4f1ea", "#c27a3a"]);
}

function deer(): Model {
  const p = new Parts();
  p.box(0.4, 0.42, 0.9, [0, 0.42, 0])
    .box(0.16, 0.4, 0.2, [0, 0.7, 0.5])
    .ball(0.17, [0, 1.12, 0.62], undefined, 1.1);
  p.ball(0.12, [0, 1.06, 0.78], "#efe6d8")
    .ball(0.16, [-0.2, 1.3, 0.55], undefined, 0.45)
    .ball(0.16, [0.2, 1.3, 0.55], undefined, 0.45);
  p.ball(0.06, [-0.2, 1.3, 0.56], "#e8b4a8", 0.4).ball(0.06, [0.2, 1.3, 0.56], "#e8b4a8", 0.4);
  for (const x of [-0.13, 0.13]) for (const z of [-0.32, 0.32]) p.box(0.07, 0.5, 0.07, [x, 0, z]);
  p.box(0.12, 0.12, 0.05, [0, 0.78, -0.47], "#fbf8f1");
  p.box(0.04, 0.04, 0.03, [-0.07, 1.16, 0.77], "#2b2b2b").box(
    0.04,
    0.04,
    0.03,
    [0.07, 1.16, 0.77],
    "#2b2b2b",
  );
  return p.build(1.8, ["#b8895a", "#a8794c", "#c49a6c"]);
}

function raccoon(): Model {
  const p = new Parts();
  p.box(0.3, 0.26, 0.6, [0, 0.14, 0]).ball(0.17, [0, 0.36, 0.38]);
  p.box(0.34, 0.09, 0.05, [0, 0.38, 0.52], "#2b2b2b")
    .ball(0.05, [-0.1, 0.5, 0.36], "#4a3f36", 0.8)
    .ball(0.05, [0.1, 0.5, 0.36], "#4a3f36", 0.8);
  p.ball(0.06, [0, 0.31, 0.53], "#efe6d8");
  for (let i = 0; i < 4; i++)
    p.box(0.16, 0.14, 0.1, [0, 0.2, -0.36 - i * 0.1], i % 2 ? "#3a312a" : "#a89886");
  for (const x of [-0.1, 0.1])
    for (const z of [-0.2, 0.2]) p.box(0.06, 0.14, 0.06, [x, 0, z], "#3a312a");
  return p.build(2.3, ["#8a7a68", "#7d6e5d", "#9a8a76"]);
}

const BUILDERS: Readonly<Record<LifeKind, () => Model>> = {
  sedan,
  suv,
  van,
  truck,
  tanker,
  person,
  cat,
  deer,
  raccoon,
};

export const modelOf = (kind: LifeKind): Model => BUILDERS[kind]();
