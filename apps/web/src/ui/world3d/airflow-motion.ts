/**
 * The air itself (REQ-072, ADR-0074): soft puffs, each a billboard sprite sharing one radial-falloff
 * texture, and small cones for arrows, both riding along smooth paths. Speed and opacity grow with the
 * strength of the path. A path is sampled once into a table of equally spaced points, so a frame costs a
 * lookup per puff and nothing is allocated. Lines and ribbons are not used: they read as noodles.
 */
import * as THREE from "three";
import { world3d } from "../../logic";
import { ORDER } from "./airflow-floor";

type FlowPath = world3d.FlowPath;
type AirView = world3d.AirView;

const SAMPLES = 32;
const COLD = new THREE.Color("#2b8fe6");
const HOT = new THREE.Color("#ff7a4a");
const WARM = new THREE.Color("#ffc06a");
const UP = new THREE.Vector3(0, 1, 0);

/** A path sampled at equal steps of length: points, and the direction of travel at each. */
interface Track {
  readonly path: FlowPath;
  readonly at: Float32Array;
  readonly dir: Float32Array;
  readonly color: THREE.Color;
  /** Metres per second along the path, and the same as a share of its length. */
  readonly speed: number;
  readonly rate: number;
  /** The sprites riding on it, and the arrows. */
  readonly puffs: number;
  readonly first: number;
  readonly arrows: number;
  readonly firstArrow: number;
}

function colorOf(path: FlowPath): THREE.Color {
  if (path.kind === "supply" || path.kind === "rise") return COLD;
  if (path.kind === "return") return HOT;
  return WARM.clone().lerp(HOT, Math.min(1, Math.max(0, (path.valueC - 30) / 20)));
}

function sample(path: FlowPath): { at: Float32Array; dir: Float32Array } {
  const curve = new THREE.CatmullRomCurve3(
    path.points.map((p) => new THREE.Vector3(...p)),
    false,
    "centripetal",
  );
  const points = curve.getSpacedPoints(SAMPLES);
  const at = new Float32Array(points.length * 3);
  const dir = new Float32Array(points.length * 3);
  const d = new THREE.Vector3();
  points.forEach((p, i) => {
    at.set([p.x, p.y, p.z], i * 3);
    const a = points[Math.max(0, i - 1)] as THREE.Vector3;
    const b = points[Math.min(points.length - 1, i + 1)] as THREE.Vector3;
    d.subVectors(b, a).normalize();
    dir.set([d.x, d.y, d.z], i * 3);
  });
  return { at, dir };
}

/** How fast the air on a path moves, metres per second. */
const speedOf = (path: FlowPath): number => {
  const base = path.kind === "rise" ? 0.25 : path.kind === "exhaust" ? 0.3 : 0.4;
  return base + (path.kind === "rise" ? 0.7 : 0.9) * path.strength;
};

export function tracksOf(paths: readonly FlowPath[]): Track[] {
  let puffs = 0;
  let arrows = 0;
  return paths.map((path) => {
    const speed = speedOf(path);
    const t: Track = {
      path,
      ...sample(path),
      color: colorOf(path),
      speed,
      rate: speed / Math.max(path.length, 0.5),
      puffs: path.puffs,
      first: puffs,
      arrows: path.arrows,
      firstArrow: arrows,
    };
    puffs += path.puffs;
    arrows += path.arrows;
    return t;
  });
}

/** Where along a track (0..1) is, as a point and a direction, written into `p` and `d`. */
function pointAt(t: Track, f: number, p: THREE.Vector3, d: THREE.Vector3): void {
  const x = Math.min(0.9999, Math.max(0, f)) * SAMPLES;
  const i = Math.floor(x);
  const k = x - i;
  const a = i * 3;
  const at = (j: number) => (t.at[j] ?? 0) + ((t.at[j + 3] ?? 0) - (t.at[j] ?? 0)) * k;
  p.set(at(a), at(a + 1), at(a + 2));
  d.set(t.dir[a] ?? 0, t.dir[a + 1] ?? 1, t.dir[a + 2] ?? 0);
}

/** Opacity of a puff by kind, in the approved look: the temperature views keep the air at half. */
function alphaOf(path: FlowPath, view: AirView, topDown: boolean): number {
  const k = view === "flow" ? 1 : 0.5;
  const s = path.strength;
  const warm = Math.min(1, Math.max(0, (path.valueC - 30) / 20));
  switch (path.kind) {
    case "rise":
      return (topDown ? 0.5 : 0.34) * k * (0.35 + s);
    case "exhaust":
      return 0.34 * k * (0.5 + warm);
    case "supply":
      return (topDown ? 0.7 : 0.6) * k * (0.45 + 0.55 * s);
    default:
      return 0.4 * k * (0.35 + 0.65 * s);
  }
}

/** Size of a puff at the start and at the end of its path, metres. */
function sizeOf(path: FlowPath): [number, number] {
  const s = path.strength;
  if (path.kind === "rise") return [0.4, 0.85 + 0.5 * s];
  if (path.kind === "exhaust") return [0.35, 1.1];
  if (path.kind === "supply") return [1.6, 2.4];
  return [1.4, 2.2];
}

/** A radial falloff, white in the middle and clear at the edge: every puff shares it. */
export function puffTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d") as CanvasRenderingContext2D;
  const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, "rgba(255,255,255,1)");
  r.addColorStop(0.45, "rgba(255,255,255,0.55)");
  r.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = r;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** The sprites and cones of one room. */
export class AirMotion {
  readonly group = new THREE.Group();
  private tracks: Track[] = [];
  private readonly sprites: THREE.Sprite[] = [];
  private readonly texture = puffTexture();
  private readonly cone = new THREE.ConeGeometry(0.24, 0.62, 12);
  private readonly coneMaterial = new THREE.MeshBasicMaterial({
    color: "#ffffff",
    transparent: true,
    opacity: 0.88,
    depthWrite: false,
  });
  private arrowMesh: THREE.InstancedMesh | undefined;
  private view: AirView = "flow";
  private topDown = false;
  /** How strained the machine is: each level shows half as many puffs and arrows, spread over all paths. */
  private level = 0;
  private readonly p = new THREE.Vector3();
  private readonly d = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();
  private readonly m = new THREE.Matrix4();
  private readonly one = new THREE.Vector3(1, 1, 1);
  private readonly gone = new THREE.Matrix4().makeScale(0, 0, 0);

  /** Puffs laid down, and how many of them are shown at the current level. */
  private get puffsLaid(): number {
    return this.tracks.reduce((n, t) => n + t.puffs, 0);
  }

  private get arrowsLaid(): number {
    return this.tracks.reduce((n, t) => n + t.arrows, 0);
  }

  get puffs(): number {
    return this.tracks.reduce((n, t) => n + this.puffsOf(t), 0);
  }

  get arrows(): number {
    return this.tracks.reduce((n, t) => n + this.arrowsOf(t), 0);
  }

  /** How many of a path's puffs and arrows are shown: every 2^level-th of all in the room, so each level halves the total. */
  private puffsOf(t: Track): number {
    return world3d.keptAmong(t.first, t.puffs, this.level);
  }

  private arrowsOf(t: Track): number {
    return world3d.keptAmong(t.firstArrow, t.arrows, this.level);
  }

  setLevel(level: number): void {
    this.level = level;
  }

  /** Lay new paths down. The sprites made earlier are reused; any spare ones are let go. */
  set(paths: readonly FlowPath[], view: AirView, topDown: boolean): void {
    this.tracks = tracksOf(paths);
    this.view = view;
    this.topDown = topDown;
    const need = this.puffsLaid;
    while (this.sprites.length < need) {
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: this.texture,
          transparent: true,
          depthWrite: false,
          blending: THREE.NormalBlending,
        }),
      );
      sprite.renderOrder = ORDER.puffs;
      sprite.frustumCulled = false;
      this.sprites.push(sprite);
      this.group.add(sprite);
    }
    while (this.sprites.length > need) {
      const s = this.sprites.pop() as THREE.Sprite;
      s.removeFromParent();
      s.material.dispose();
    }
    this.arrowMesh?.removeFromParent();
    this.arrowMesh?.dispose();
    this.arrowMesh = undefined;
    const arrows = this.arrowsLaid;
    if (arrows > 0) {
      this.arrowMesh = new THREE.InstancedMesh(this.cone, this.coneMaterial, arrows);
      this.arrowMesh.renderOrder = ORDER.arrows;
      this.arrowMesh.frustumCulled = false;
      for (const t of this.tracks)
        for (let k = 0; k < t.arrows; k++) this.arrowMesh.setColorAt(t.firstArrow + k, t.color);
      this.group.add(this.arrowMesh);
    }
  }

  setTopDown(on: boolean): void {
    this.topDown = on;
  }

  /** Show the puffs (moving or not) and the arrows, or only the arrows standing still. */
  draw(time: number, puffsOn: boolean, moving: boolean): void {
    this.drawPuffs(time, puffsOn);
    this.drawArrows(time, moving);
  }

  private drawPuffs(time: number, on: boolean): void {
    for (const t of this.tracks) {
      const [s0, s1] = sizeOf(t.path);
      const alpha = alphaOf(t.path, this.view, this.topDown);
      const shown = this.puffsOf(t);
      for (let j = 0; j < t.puffs; j++) {
        const sprite = this.sprites[t.first + j] as THREE.Sprite;
        sprite.visible = on && j < shown;
        if (!sprite.visible) continue;
        const f = (j / shown + time * t.rate) % 1;
        pointAt(t, f, this.p, this.d);
        sprite.position.copy(this.p);
        const size = s0 + (s1 - s0) * f;
        sprite.scale.set(size, size, 1);
        const edge = Math.min(1, f * 5, (1 - f) * 5);
        const material = sprite.material;
        material.color.copy(t.color);
        material.opacity = alpha * edge;
      }
    }
  }

  private drawArrows(time: number, moving: boolean): void {
    const mesh = this.arrowMesh;
    if (!mesh) return;
    for (const t of this.tracks) {
      const shown = this.arrowsOf(t);
      for (let k = 0; k < t.arrows; k++) {
        if (k >= shown) {
          mesh.setMatrixAt(t.firstArrow + k, this.gone);
          continue;
        }
        const f = moving ? ((k + 0.5) / shown + time * t.rate) % 1 : (k + 1) / (shown + 1);
        pointAt(t, f, this.p, this.d);
        this.q.setFromUnitVectors(UP, this.d);
        mesh.setMatrixAt(t.firstArrow + k, this.m.compose(this.p, this.q, this.one));
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    for (const s of this.sprites) {
      s.removeFromParent();
      s.material.dispose();
    }
    this.sprites.length = 0;
    this.arrowMesh?.removeFromParent();
    this.arrowMesh?.dispose();
    this.cone.dispose();
    this.coneMaterial.dispose();
    this.texture.dispose();
    this.group.removeFromParent();
  }
}
