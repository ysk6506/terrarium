/**
 * Racks as instanced meshes (REQ-006, REQ-036, REQ-049): every rack of one model on a floor is one
 * draw call however many there are. A rack is a box with a perforated door; a rack with a rear-door
 * heat exchanger has a coil door, a direct-liquid-cooled one has two manifolds, and an immersion tank
 * shows the coolant with the servers' handles in it. Colour per rack comes from the active layer.
 */
import * as THREE from "three";
import { world3d } from "../../logic";
import type { Materials } from "./materials";

type RackSet = world3d.RackSet;

interface Entry {
  readonly set: RackSet;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

interface Built {
  readonly entries: readonly Entry[];
  readonly ids: readonly string[];
  readonly body: THREE.InstancedMesh;
  readonly meshes: readonly THREE.InstancedMesh[];
  readonly start: readonly number[];
}

const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
/** Racks of the same row this close to the one looked at stay as faint shapes; every other rack is cleared, metres between centres. */
const BESIDE_M = 3.4;
/** The racks beside the one looked at stay as faint shapes, so the row is still a row (feedback 6). */
const GHOST = new THREE.MeshStandardMaterial({
  color: 0x39424b,
  transparent: true,
  opacity: 0.28,
  depthWrite: false,
});
const UP = new THREE.Vector3(0, 1, 0);

function bodyGeometry(kind: world3d.RackSet["kind"]): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(kind.w, kind.h, kind.d);
  g.translate(0, kind.h / 2, 0);
  return g;
}

function bodyMaterials(m: Materials, form: world3d.RackForm): THREE.Material[] {
  if (form === "tank")
    return [m.tankShell, m.tankShell, m.tankTop, m.tankShell, m.tankShell, m.tankShell];
  return [m.rackSkin, m.rackSkin, m.rackSkin, m.rackSkin, m.rackFace, m.rackSkin];
}

export class RackFleet {
  readonly group = new THREE.Group();
  private readonly pending = new Map<string, Entry[]>();
  private built: Built[] = [];
  private readonly hidden = new Map<string, THREE.Matrix4>();

  constructor(private readonly m: Materials) {}

  /** Add the racks of a set; `at` places the set's frame. */
  add(set: RackSet, at: { x: number; y: number; z: number }): void {
    const list = this.pending.get(set.kind.key) ?? [];
    list.push({ set, ...at });
    this.pending.set(set.kind.key, list);
  }

  /** Create the meshes. Call once, after every `add`. */
  build(): void {
    for (const entries of this.pending.values()) this.built.push(this.make(entries));
    this.pending.clear();
  }

  private make(entries: readonly Entry[]): Built {
    const kind = (entries[0] as Entry).set.kind;
    const total = entries.reduce((n, e) => n + e.set.ids.length, 0);
    const body = new THREE.InstancedMesh(
      bodyGeometry(kind),
      bodyMaterials(this.m, kind.form),
      total,
    );
    const ids: string[] = [];
    const start: number[] = [];
    const matrix = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    let n = 0;
    for (const e of entries) {
      start.push(n);
      e.set.ids.forEach((id, i) => {
        const a = e.set.at;
        matrix.compose(
          new THREE.Vector3(
            e.x + (a[i * 4] as number),
            e.y + (a[i * 4 + 1] as number),
            e.z + (a[i * 4 + 2] as number),
          ),
          q.setFromAxisAngle(UP, a[i * 4 + 3] as number),
          one,
        );
        body.setMatrixAt(n, matrix);
        ids.push(id);
        n++;
      });
    }
    const extras = this.extras(kind, body);
    const meshes = [body, ...extras];
    for (const mesh of meshes) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      this.group.add(mesh);
    }
    body.userData.ids = ids;
    return { entries, ids, body, meshes, start };
  }

  /** The rear door of a heat exchanger, the manifolds of a direct-liquid rack: they follow the body's matrices. */
  private extras(kind: RackSet["kind"], body: THREE.InstancedMesh): THREE.InstancedMesh[] {
    const parts: Array<[THREE.BufferGeometry, THREE.Material]> = [];
    if (kind.form === "rdhx") {
      const door = new THREE.BoxGeometry(kind.w * 0.98, kind.h * 0.97, 0.1);
      door.translate(0, kind.h / 2, -kind.d / 2 - 0.06);
      parts.push([door, this.m.coilDoor]);
    } else if (kind.form === "dlc") {
      for (const [dx, mat] of [
        [-1, this.m.supply],
        [1, this.m.returning],
      ] as const) {
        const pipe = new THREE.CylinderGeometry(0.035, 0.035, kind.h * 0.92, 8);
        pipe.translate(dx * (kind.w / 2 - 0.09), kind.h * 0.5, -kind.d / 2 - 0.05);
        parts.push([pipe, mat]);
      }
    }
    return parts.map(([geo, mat]) => {
      const mesh = new THREE.InstancedMesh(geo, mat, body.count);
      mesh.instanceMatrix = body.instanceMatrix;
      return mesh;
    });
  }

  /** Paint every rack for the layer being looked at. */
  recolor(layer: world3d.Layer, overlay: world3d.Overlay): void {
    for (const b of this.built) {
      const colors = new Float32Array(b.ids.length * 3);
      for (const [k, e] of b.entries.entries())
        colors.set(world3d.rackColors(layer, overlay, e.set), (b.start[k] as number) * 3);
      b.body.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
      b.body.instanceColor.needsUpdate = true;
    }
  }

  /** The rack an instance of one of these meshes stands for. */
  idOf(object: THREE.Object3D, instanceId: number | undefined): string | undefined {
    const ids = object.userData.ids as readonly string[] | undefined;
    return ids && instanceId !== undefined ? ids[instanceId] : undefined;
  }

  /** The meshes a ray may hit (the bodies). */
  get pickables(): THREE.Object3D[] {
    return this.built.map((b) => b.body);
  }

  /** Where a rack stands, in the fleet's frame, or undefined if it is not here. */
  position(id: string): THREE.Vector3 | undefined {
    for (const b of this.built) {
      const i = b.ids.indexOf(id);
      if (i < 0) continue;
      const m = new THREE.Matrix4();
      b.body.getMatrixAt(i, m);
      return new THREE.Vector3().setFromMatrixPosition(this.hidden.get(id) ?? m);
    }
    return undefined;
  }

  /** Where a rack stands and which way it faces, in the fleet's frame. */
  placement(id: string): { position: THREE.Vector3; rot: number } | undefined {
    for (const b of this.built) {
      const i = b.ids.indexOf(id);
      if (i < 0) continue;
      const m = this.hidden.get(id) ?? new THREE.Matrix4();
      if (!this.hidden.has(id)) b.body.getMatrixAt(i, m);
      const q = new THREE.Quaternion();
      const p = new THREE.Vector3();
      m.decompose(p, q, new THREE.Vector3());
      return { position: p, rot: new THREE.Euler().setFromQuaternion(q, "YXZ").y };
    }
    return undefined;
  }

  /** Clear the racks round one so its face can be seen: its row neighbours stay as faint shapes. Returns how to put them back. */
  hideInFront(id: string): () => void {
    const at = this.placement(id);
    if (!at) return () => {};
    const cos = Math.cos(at.rot);
    const sin = Math.sin(at.rot);
    const saved: Array<[THREE.InstancedMesh, number, THREE.Matrix4]> = [];
    const aside: Array<[THREE.BufferGeometry, THREE.Matrix4[]]> = [];
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    for (const b of this.built)
      b.ids.forEach((other, i) => {
        if (other === id || this.hidden.has(other)) return;
        b.body.getMatrixAt(i, m);
        p.setFromMatrixPosition(m);
        const dx = p.x - at.position.x;
        const dz = p.z - at.position.z;
        const lx = dx * cos - dz * sin;
        const lz = dx * sin + dz * cos;
        // The racks in front, and the one on either side, so the rack stands clear to be read (feedback 6).
        const beside = Math.abs(lz) < 0.7 && Math.abs(lx) < BESIDE_M;
        if (Math.abs(p.y - at.position.y) > 1.5) return;
        saved.push([b.body, i, m.clone()]);
        if (beside) {
          const entry = aside.find(([g]) => g === b.body.geometry);
          if (entry) entry[1].push(m.clone());
          else aside.push([b.body.geometry, [m.clone()]]);
        }
        b.body.setMatrixAt(i, ZERO);
        b.body.instanceMatrix.needsUpdate = true;
      });
    const ghosts = aside.map(([geometry, list]) => {
      const mesh = new THREE.InstancedMesh(geometry, GHOST, list.length);
      for (const [i, matrix] of list.entries()) mesh.setMatrixAt(i, matrix);
      mesh.frustumCulled = false;
      this.group.add(mesh);
      return mesh;
    });
    return () => {
      for (const mesh of ghosts) mesh.removeFromParent();
      for (const [mesh, i, matrix] of saved) {
        mesh.setMatrixAt(i, matrix);
        mesh.instanceMatrix.needsUpdate = true;
      }
    };
  }

  /** Take a rack out of the picture (it is shown in detail elsewhere) or put it back. */
  setHidden(id: string, hide: boolean): void {
    for (const b of this.built) {
      const i = b.ids.indexOf(id);
      if (i < 0) continue;
      if (hide && !this.hidden.has(id)) {
        const m = new THREE.Matrix4();
        b.body.getMatrixAt(i, m);
        this.hidden.set(id, m);
        b.body.setMatrixAt(i, ZERO);
      } else if (!hide && this.hidden.has(id)) {
        b.body.setMatrixAt(i, this.hidden.get(id) as THREE.Matrix4);
        this.hidden.delete(id);
      }
      b.body.instanceMatrix.needsUpdate = true;
    }
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const b of this.built) for (const mesh of b.meshes) mesh.geometry.dispose();
    this.built = [];
  }
}
