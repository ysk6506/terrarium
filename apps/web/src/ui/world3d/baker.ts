/**
 * Static scenery without a draw call per part: boxes, cylinders and pipes are collected by material
 * and merged into one mesh each. A whole campus of buildings, plants and roads ends up as a few dozen
 * draw calls, which is what keeps the view light (REQ-036).
 */
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

export interface PartOptions {
  /** Corner rounding, metres (0 for sharp). */
  readonly round?: number;
  /** Turn about the vertical axis, radians. */
  readonly rot?: number;
  /** Cast a shadow (default true). */
  readonly shadow?: boolean;
  /** Texture tile size in metres: UVs follow world position so a pattern keeps its scale. */
  readonly tile?: number;
}

/** A box standing on `y` (default the ground), centred on (x, z). */
export interface BoxSpec extends PartOptions {
  readonly x: number;
  readonly z: number;
  readonly w: number;
  readonly d: number;
  readonly h: number;
  readonly y?: number;
}

/** An upright cylinder, or a cone frustum when `top` differs from `r`. */
export interface CylSpec extends PartOptions {
  readonly x: number;
  readonly z: number;
  readonly r: number;
  readonly h: number;
  readonly y?: number;
  readonly top?: number;
  readonly seg?: number;
}

/** A cylinder lying along x (or along z when turned) at the given height. */
export interface LyingSpec extends PartOptions {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly r: number;
  readonly length: number;
}

/** A flat horizontal sheet at height `y`. */
export interface SheetSpec extends PartOptions {
  readonly x: number;
  readonly z: number;
  readonly w: number;
  readonly d: number;
  readonly y: number;
}

type V3 = readonly [number, number, number];

const UP = new THREE.Vector3(0, 1, 0);
const ONE = new THREE.Vector3(1, 1, 1);

/** Unit shapes shared by every part of the same kind: scaled into place instead of built again each time. */
const TEMPLATES = new Map<string, THREE.BufferGeometry>();

/** Rounded boxes differ by size, so they are kept only while few (a view of one site makes a few dozen). */
const TEMPLATE_CAP = 400;

function template(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let t = TEMPLATES.get(key);
  if (!t) {
    if (TEMPLATES.size >= TEMPLATE_CAP) {
      for (const g of TEMPLATES.values()) g.dispose();
      TEMPLATES.clear();
    }
    const g = make();
    t = g.index ? g.toNonIndexed() : g;
    if (t !== g) g.dispose();
    TEMPLATES.set(key, t);
  }
  return t;
}

/** A float array that grows as parts are poured into it. */
class Pour {
  data = new Float32Array(1024);
  length = 0;

  /** Room for `n` more numbers; returns where they start. */
  reserve(n: number): number {
    if (this.length + n > this.data.length) {
      const next = new Float32Array(Math.max(this.data.length * 2, this.length + n));
      next.set(this.data.subarray(0, this.length));
      this.data = next;
    }
    const at = this.length;
    this.length += n;
    return at;
  }

  array(): Float32Array {
    return this.data.slice(0, this.length);
  }
}

interface Bucket {
  readonly mat: THREE.Material;
  readonly shadow: boolean;
  readonly pos: Pour;
  readonly nor: Pour;
  readonly uv: Pour;
}

const M3 = new THREE.Matrix3();

export class Baker {
  private readonly parts = new Map<string, Bucket>();
  private readonly ids = new Map<THREE.Material, number>();
  private base = new THREE.Matrix4();

  private key(mat: THREE.Material, shadow: boolean): string {
    let id = this.ids.get(mat);
    if (id === undefined) {
      id = this.ids.size;
      this.ids.set(mat, id);
    }
    return `${id}:${shadow ? 1 : 0}`;
  }

  /** Add any geometry, already placed by a matrix. */
  add(
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    matrix: THREE.Matrix4,
    opts: PartOptions = {},
  ): void {
    const flat = geo.index ? geo.toNonIndexed() : geo;
    pour(
      this.bucket(mat, opts.shadow !== false),
      flat,
      this.base.clone().multiply(matrix),
      opts.tile,
    );
    if (flat !== geo) flat.dispose();
  }

  private bucket(mat: THREE.Material, shadow: boolean): Bucket {
    const k = this.key(mat, shadow);
    let bucket = this.parts.get(k);
    if (!bucket) {
      bucket = { mat, shadow, pos: new Pour(), nor: new Pour(), uv: new Pour() };
      this.parts.set(k, bucket);
    }
    return bucket;
  }

  /** Everything added inside `fn` is placed in a frame centred on (x, z) and turned by `rot`. */
  frame(x: number, z: number, rot: number, fn: () => void): void {
    const before = this.base;
    this.base = before
      .clone()
      .multiply(
        new THREE.Matrix4().compose(
          new THREE.Vector3(x, 0, z),
          new THREE.Quaternion().setFromAxisAngle(UP, rot),
          ONE,
        ),
      );
    try {
      fn();
    } finally {
      this.base = before;
    }
  }

  box(mat: THREE.Material, s: BoxSpec): void {
    const r = Math.min(s.round ?? 0, s.w / 2.2, s.d / 2.2, s.h / 2.2);
    const at = new THREE.Vector3(s.x, (s.y ?? 0) + s.h / 2, s.z);
    const turn = new THREE.Quaternion().setFromAxisAngle(UP, s.rot ?? 0);
    if (r > 0.02) {
      const geo = template(
        `round:${s.w.toFixed(3)}:${s.h.toFixed(3)}:${s.d.toFixed(3)}:${r.toFixed(3)}`,
        () => new RoundedBoxGeometry(s.w, s.h, s.d, 1, r),
      );
      this.add(geo, mat, new THREE.Matrix4().compose(at, turn, ONE), s);
      return;
    }
    const unit = template("box", () => new THREE.BoxGeometry(1, 1, 1));
    this.add(unit, mat, new THREE.Matrix4().compose(at, turn, new THREE.Vector3(s.w, s.h, s.d)), s);
  }

  cyl(mat: THREE.Material, s: CylSpec): void {
    const seg = s.seg ?? 20;
    const ratio = (s.top ?? s.r) / s.r;
    const unit = template(
      `cyl:${ratio}:${seg}`,
      () => new THREE.CylinderGeometry(ratio, 1, 1, seg),
    );
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(s.x, (s.y ?? 0) + s.h / 2, s.z),
      new THREE.Quaternion(),
      new THREE.Vector3(s.r, s.h, s.r),
    );
    this.add(unit, mat, m, s);
  }

  lying(mat: THREE.Material, s: LyingSpec): void {
    const unit = template("cyl:1:18", () => new THREE.CylinderGeometry(1, 1, 1, 18));
    const m = new THREE.Matrix4()
      .makeTranslation(s.x, s.y, s.z)
      .multiply(new THREE.Matrix4().makeRotationY(s.rot ?? 0))
      .multiply(new THREE.Matrix4().makeRotationZ(Math.PI / 2))
      .multiply(new THREE.Matrix4().makeScale(s.r, s.length, s.r));
    this.add(unit, mat, m, s);
  }

  /** A pipe from a to b. */
  pipe(mat: THREE.Material, a: V3, b: V3, r = 0.1, opts: PartOptions = {}): void {
    const from = new THREE.Vector3(...a);
    const to = new THREE.Vector3(...b);
    const length = from.distanceTo(to);
    if (length < 1e-3) return;
    const unit = template("cyl:1:10", () => new THREE.CylinderGeometry(1, 1, 1, 10));
    const q = new THREE.Quaternion().setFromUnitVectors(UP, to.clone().sub(from).normalize());
    const m = new THREE.Matrix4().compose(
      from.clone().add(to).multiplyScalar(0.5),
      q,
      new THREE.Vector3(r, length, r),
    );
    this.add(unit, mat, m, opts);
  }

  sheet(mat: THREE.Material, s: SheetSpec): void {
    const unit = template("plane", () => new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2));
    const m = new THREE.Matrix4()
      .makeTranslation(s.x, s.y, s.z)
      .multiply(new THREE.Matrix4().makeRotationY(s.rot ?? 0))
      .multiply(new THREE.Matrix4().makeScale(s.w, 1, s.d));
    this.add(unit, mat, m, { shadow: false, ...s });
  }

  /** Merge each material's parts into one mesh. */
  bake(): THREE.Group {
    const group = new THREE.Group();
    for (const { mat, shadow, pos, nor, uv } of this.parts.values()) {
      if (pos.length === 0) continue;
      const merged = new THREE.BufferGeometry();
      merged.setAttribute("position", new THREE.BufferAttribute(pos.array(), 3));
      merged.setAttribute("normal", new THREE.BufferAttribute(nor.array(), 3));
      merged.setAttribute("uv", new THREE.BufferAttribute(uv.array(), 2));
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = shadow;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    this.parts.clear();
    return group;
  }
}

/** Copy a flat geometry into a bucket, moved by `placed`; with `tile` the UVs follow world position instead of the shape. */
function pour(
  bucket: Bucket,
  flat: THREE.BufferGeometry,
  placed: THREE.Matrix4,
  tile?: number,
): void {
  const p = flat.getAttribute("position").array as ArrayLike<number>;
  const n = flat.getAttribute("normal").array as ArrayLike<number>;
  const t = flat.getAttribute("uv")?.array as ArrayLike<number> | undefined;
  const e = placed.elements;
  const nm = M3.getNormalMatrix(placed).elements;
  const count = p.length / 3;
  const pi = bucket.pos.reserve(count * 3);
  const ni = bucket.nor.reserve(count * 3);
  const ui = bucket.uv.reserve(count * 2);
  const { data: pos } = bucket.pos;
  const { data: nor } = bucket.nor;
  const { data: uv } = bucket.uv;
  for (let i = 0; i < count; i++) {
    const x = p[i * 3] as number;
    const y = p[i * 3 + 1] as number;
    const z = p[i * 3 + 2] as number;
    const wx = e[0] * x + e[4] * y + e[8] * z + e[12];
    const wy = e[1] * x + e[5] * y + e[9] * z + e[13];
    const wz = e[2] * x + e[6] * y + e[10] * z + e[14];
    pos[pi + i * 3] = wx;
    pos[pi + i * 3 + 1] = wy;
    pos[pi + i * 3 + 2] = wz;
    const a = n[i * 3] as number;
    const b = n[i * 3 + 1] as number;
    const c = n[i * 3 + 2] as number;
    const nx = nm[0] * a + nm[3] * b + nm[6] * c;
    const ny = nm[1] * a + nm[4] * b + nm[7] * c;
    const nz = nm[2] * a + nm[5] * b + nm[8] * c;
    const len = Math.hypot(nx, ny, nz) || 1;
    nor[ni + i * 3] = nx / len;
    nor[ni + i * 3 + 1] = ny / len;
    nor[ni + i * 3 + 2] = nz / len;
    if (tile) {
      // The dominant axis of the normal says which face of a box this is: look at it from there.
      const [ax, ay, az] = [Math.abs(nx), Math.abs(ny), Math.abs(nz)];
      const up = ay >= ax && ay >= az;
      uv[ui + i * 2] = (!up && ax >= az ? wz : wx) / tile;
      uv[ui + i * 2 + 1] = (up ? wz : wy) / tile;
    } else if (t) {
      uv[ui + i * 2] = t[i * 2] as number;
      uv[ui + i * 2 + 1] = t[i * 2 + 1] as number;
    }
  }
}

/** Release a group's geometries, materials excluded (materials are shared and live as long as the view). */
export function disposeGeometry(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
  });
}
