/**
 * The runs at work, drawn over the 3D picture (REQ-050). Each run is a marker where the equipment it
 * named last stands: a ring that spreads and fades, a disc, a pole to hang its name on, and a line
 * through the places it was before. A look is a ring that breathes out, an act is a bold disc and a
 * faster, wider ring, a wait is slow and pale, an answer is a steady ring. A failed call turns the
 * marker red. Markers keep one size on the screen however far the camera is, and fade as a run sits quiet.
 * They draw on top of the buildings, so a run inside a closed building can still be seen.
 */
import * as THREE from "three";
import { world3d } from "../../logic";
import type { Engine } from "./engine";

const FAIL = "#c43d2b";
const POLE_PX = 46;
const RING_PX = 22;
const BREATH_S = { observe: 1.6, act: 0.9, wait: 3.4, answer: 0 } as const;

const ring = new THREE.RingGeometry(0.82, 1, 48).rotateX(-Math.PI / 2);
const disc = new THREE.CircleGeometry(0.5, 24).rotateX(-Math.PI / 2);
const pole = new THREE.CylinderGeometry(0.07, 0.07, 1, 6).translate(0, 0.5, 0);

const basic = (color: string): THREE.MeshBasicMaterial =>
  new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });

interface Node {
  readonly group: THREE.Group;
  readonly ring: THREE.Mesh;
  readonly disc: THREE.Mesh;
  readonly pole: THREE.Mesh;
  readonly line: THREE.Line;
  marker: world3d.Marker;
}

function lineOf(color: string): THREE.Line {
  const line = new THREE.Line(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({
      color,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  line.renderOrder = 11;
  line.frustumCulled = false;
  return line;
}

function nodeOf(marker: world3d.Marker): Node {
  const color = world3d.WORKER_COLORS[marker.hue % world3d.WORKER_COLORS.length] as string;
  const group = new THREE.Group();
  const r = new THREE.Mesh(ring, basic(color));
  const d = new THREE.Mesh(disc, basic(color));
  const p = new THREE.Mesh(pole, basic(color));
  for (const [i, m] of [r, d, p].entries()) m.renderOrder = 12 + i;
  group.add(r, d, p);
  return { group, ring: r, disc: d, pole: p, line: lineOf(color), marker };
}

function disposeNode(node: Node): void {
  node.group.removeFromParent();
  node.line.removeFromParent();
  for (const m of [node.ring, node.disc, node.pole]) (m.material as THREE.Material).dispose();
  node.line.geometry.dispose();
  (node.line.material as THREE.Material).dispose();
}

export class ActivityLayer {
  readonly group = new THREE.Group();
  private readonly nodes = new Map<string, Node>();
  private stop: (() => void) | undefined;
  private off: (() => void) | undefined;

  constructor(
    private readonly engine: Engine,
    /** How far the building a spot is in has lifted that spot's floor, metres. */
    private readonly lift: (spot: world3d.Spot) => number,
    private readonly clock: () => number,
  ) {}

  /** The place a marker is drawn at, lifted with its floor. */
  place(spot: world3d.Spot): THREE.Vector3 {
    return new THREE.Vector3(spot.x, spot.y + this.lift(spot), spot.z);
  }

  /** Metres that make `px` pixels at `at`, for the camera as it is. */
  private metres(at: THREE.Vector3, px: number): number {
    const cam = this.engine.camera;
    const height = this.engine.renderer.domElement.clientHeight || 1;
    const per =
      (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2) * cam.position.distanceTo(at)) / height;
    return per * px;
  }

  set(markers: readonly world3d.Marker[]): void {
    const keep = new Set(markers.map((m) => m.runId));
    for (const [id, node] of this.nodes)
      if (!keep.has(id)) {
        disposeNode(node);
        this.nodes.delete(id);
      }
    for (const m of markers) {
      let node = this.nodes.get(m.runId);
      if (!node || node.marker.hue !== m.hue) {
        if (node) disposeNode(node);
        node = nodeOf(m);
        this.nodes.set(m.runId, node);
        this.group.add(node.group, node.line);
      }
      node.marker = m;
    }
    if (this.nodes.size > 0 && !this.stop) {
      this.stop = this.engine.animate();
      this.off = this.engine.onFrame((_, time) => this.draw(time));
    } else if (this.nodes.size === 0 && this.stop) this.release();
    this.engine.invalidate();
  }

  private release(): void {
    this.off?.();
    this.stop?.();
    this.off = undefined;
    this.stop = undefined;
  }

  private draw(time: number): void {
    const now = this.clock();
    for (const node of this.nodes.values()) {
      const m = node.marker;
      const at = this.place(m.at);
      const fresh = world3d.freshness(m.lastAt, now);
      const scale = this.metres(at, RING_PX);
      const failed = !m.ok;
      const tint = failed
        ? FAIL
        : (world3d.WORKER_COLORS[m.hue % world3d.WORKER_COLORS.length] as string);
      node.group.position.copy(at);
      node.group.position.y += 0.05 * scale;
      const breath = BREATH_S[m.effect];
      const phase = breath === 0 ? 0 : (time / breath + m.pile * 0.27) % 1;
      const spread = m.effect === "act" ? 2.4 : 1.6;
      const grow = breath === 0 ? 1.15 : 0.7 + spread * phase;
      node.ring.scale.setScalar(scale * grow);
      node.disc.scale.setScalar(scale * (m.effect === "act" ? 1.5 : 1));
      node.pole.scale.set(scale, this.metres(at, POLE_PX + m.pile * 20), scale);
      const pale = 0.55 + 0.45 * fresh;
      this.paint(node, tint, {
        ring: breath === 0 ? pale : pale * (1 - phase),
        disc: pale * (m.effect === "act" ? 1 : m.effect === "wait" ? 0.4 : 0.7),
        pole: pale * 0.8,
      });
      this.drawTrail(node, at, fresh, tint);
    }
  }

  private paint(node: Node, color: string, o: { ring: number; disc: number; pole: number }): void {
    for (const [mesh, opacity] of [
      [node.ring, o.ring],
      [node.disc, o.disc],
      [node.pole, o.pole],
    ] as const) {
      const mat = mesh.material as THREE.MeshBasicMaterial;
      mat.color.set(color);
      mat.opacity = opacity;
    }
  }

  /** The line through the places before this one, ending at the marker. */
  private drawTrail(node: Node, at: THREE.Vector3, fresh: number, color: string): void {
    const points = [...node.marker.trail.map((s) => this.place(s)), at];
    const mat = node.line.material as THREE.LineBasicMaterial;
    mat.color.set(color);
    mat.opacity = 0.8 * (0.5 + 0.5 * fresh);
    node.line.visible = points.length > 1;
    const geo = node.line.geometry;
    const array = new Float32Array(points.flatMap((p) => [p.x, p.y + 0.4, p.z]));
    geo.setAttribute("position", new THREE.BufferAttribute(array, 3));
    geo.computeBoundingSphere();
  }

  dispose(): void {
    this.release();
    for (const node of this.nodes.values()) disposeNode(node);
    this.nodes.clear();
    this.group.removeFromParent();
  }
}
