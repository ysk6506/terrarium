/**
 * What the builder draws over the 3D picture (REQ-006): an outline round whatever is selected and the
 * ghost of what the next click would build, green where it may go and red where it may not. They are
 * given in the level's plan and ride in its frame, so a turned building keeps them aligned.
 */
import * as THREE from "three";
import type { world3d } from "../../logic";

const SELECT = "#2f6df0";
const GOOD = "#2fa66a";
const BAD = "#e0453a";

type PlanBox = world3d.PlanBox;
type PlanShape = world3d.PlanShape;
type PlanHandle = world3d.PlanHandle;

/** A closed outline as a wall: its foot, its top and a line up every corner. */
function wall(shape: PlanShape, color: string, lift: number): THREE.LineSegments {
  const n = shape.points.length;
  const pos: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = shape.points[i] as PlanShape["points"][number];
    const b = shape.points[(i + 1) % n] as PlanShape["points"][number];
    for (const y of [lift, shape.h + lift]) pos.push(a.x, y, a.z, b.x, y, b.z);
    pos.push(a.x, lift, a.z, a.x, shape.h + lift, a.z);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  const lines = new THREE.LineSegments(
    geometry,
    new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, toneMapped: false }),
  );
  lines.renderOrder = 10;
  return lines;
}

/** A handle: a white square with a blue rim for a side, a blue plus just outside it for a new piece. */
function handleMesh(h: PlanHandle): THREE.Group {
  const group = new THREE.Group();
  const fill = new THREE.MeshBasicMaterial({
    color: h.kind === "edge" ? "#ffffff" : SELECT,
    depthTest: false,
    transparent: true,
    toneMapped: false,
  });
  const rim = new THREE.MeshBasicMaterial({
    color: SELECT,
    depthTest: false,
    transparent: true,
    toneMapped: false,
  });
  const s = h.size;
  if (h.kind === "edge") {
    const back = new THREE.Mesh(new THREE.BoxGeometry(s * 1.3, 0.1, s * 1.3), rim);
    const front = new THREE.Mesh(new THREE.BoxGeometry(s, 0.14, s), fill);
    back.renderOrder = 11;
    front.renderOrder = 12;
    group.add(back, front);
  } else {
    const bar = (w: number, d: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.14, d), fill);
      m.renderOrder = 12;
      return m;
    };
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.9, s * 0.9, 0.1, 20), rim);
    disc.renderOrder = 11;
    group.add(disc, bar(s * 1.1, s * 0.28), bar(s * 0.28, s * 1.1));
  }
  group.position.set(h.x, 0.35, h.z);
  return group;
}

function edges(box: PlanBox, color: string, grow: number): THREE.LineSegments {
  const lines = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(box.w + grow, box.h + grow, box.d + grow)),
    new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, toneMapped: false }),
  );
  lines.position.set(box.x, box.y, box.z);
  lines.renderOrder = 10;
  return lines;
}

function clear(group: THREE.Group): void {
  for (const child of [...group.children]) {
    child.removeFromParent();
    const o = child as THREE.Mesh;
    o.geometry?.dispose();
    (o.material as THREE.Material | undefined)?.dispose();
  }
}

export class PlanOverlay {
  readonly group = new THREE.Group();
  private readonly plan = new THREE.Group();
  private readonly selection = new THREE.Group();
  private readonly ghost = new THREE.Group();
  private readonly shapes = new THREE.Group();
  private readonly handles = new THREE.Group();

  constructor(private readonly changed: () => void) {
    this.plan.add(this.selection, this.ghost, this.shapes, this.handles);
    this.group.add(this.plan);
    this.group.visible = false;
  }

  /** Put the plan where the level stands in the site; none hides everything. */
  setFrame(frame: world3d.PlanFrame | undefined): void {
    this.group.visible = frame !== undefined;
    if (frame) {
      this.plan.position.set(frame.x, frame.y, frame.z);
      this.plan.rotation.y = frame.rot;
    }
    this.changed();
  }

  /** Outline these boxes; an outline is drawn twice, a hair apart, so it reads as a thick line. */
  setSelection(boxes: readonly PlanBox[]): void {
    clear(this.selection);
    for (const b of boxes) this.selection.add(edges(b, SELECT, 0.05), edges(b, SELECT, 0.2));
    this.changed();
  }

  /** Outline these rooms along their walls, as high as the walls. */
  setShapes(shapes: readonly PlanShape[]): void {
    clear(this.shapes);
    for (const s of shapes) this.shapes.add(wall(s, SELECT, 0.02), wall(s, SELECT, 0.07));
    this.changed();
  }

  /** The handles of the selected room or building; none takes them away. */
  setHandles(handles: readonly PlanHandle[]): void {
    for (const child of [...this.handles.children]) {
      child.removeFromParent();
      child.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        (m.material as THREE.Material | undefined)?.dispose();
      });
    }
    for (const h of handles) this.handles.add(handleMesh(h));
    this.changed();
  }

  setGhost(ghost: (PlanBox & { readonly ok: boolean }) | undefined): void {
    clear(this.ghost);
    if (ghost) {
      const color = ghost.ok ? GOOD : BAD;
      const fill = new THREE.Mesh(
        new THREE.BoxGeometry(ghost.w, ghost.h, ghost.d),
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.28,
          depthWrite: false,
          depthTest: false,
          toneMapped: false,
        }),
      );
      fill.position.set(ghost.x, ghost.y, ghost.z);
      fill.renderOrder = 9;
      this.ghost.add(fill, edges(ghost, color, 0.05));
    }
    this.changed();
  }

  dispose(): void {
    clear(this.selection);
    clear(this.ghost);
    clear(this.shapes);
    this.setHandles([]);
    this.group.removeFromParent();
  }
}
