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

  constructor(private readonly changed: () => void) {
    this.plan.add(this.selection, this.ghost);
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
    this.group.removeFromParent();
  }
}
