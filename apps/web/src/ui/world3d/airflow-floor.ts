/**
 * What the airflow map lays on the floor and on the racks (REQ-072, ADR-0074): the temperature of the
 * floor as a soft texture blended over the tiles, the glow of the perforated tiles in the cold aisles,
 * a front door tinted for each rack, and the ring around the rack that was picked. All of it is made
 * once for a room and only recoloured when the readings change; `dispose` lets go of every piece.
 */
import * as THREE from "three";
import { world3d } from "../../logic";

type Airflow = world3d.Airflow;
type AirView = world3d.AirView;
type RoomScene = world3d.RoomScene;

/** Draw order: the floor first, then the tiles, then rings, then the air on top (sprites and arrows). */
export const ORDER = { floor: 1, tiles: 2, ring: 3, puffs: 5, arrows: 6 } as const;

/** The heat texture is drawn this many times finer than the field, smoothed, so it reads as a soft wash. */
const UPSCALE = 5;
const MAX_TEXTURE_PX = 1536;
const LIFT_M = 0.02;
const TILE_M = 0.6;
const WALL_M = 0.15;
const COLD_TILE = new THREE.Color("#3a9bf0");

const rgb255 = (
  c: world3d.Point3 | readonly [number, number, number],
): [number, number, number] => [
  Math.round(c[0] * 255),
  Math.round(c[1] * 255),
  Math.round(c[2] * 255),
];

/** The temperature of the floor as a plane lying a hair above the raised floor. */
export class HeatPlane {
  readonly mesh: THREE.Mesh;
  private readonly small = document.createElement("canvas");
  private readonly big = document.createElement("canvas");
  private readonly texture: THREE.CanvasTexture;
  private readonly material: THREE.MeshBasicMaterial;

  constructor(scene: RoomScene) {
    this.texture = new THREE.CanvasTexture(this.big);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;
    this.material = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    // It ends at the walls, not under them: a hand's width of floor stays bare along each one.
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(scene.w - 2 * WALL_M, scene.d - 2 * WALL_M),
      this.material,
    );
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.set(scene.w / 2, scene.floorY + LIFT_M, scene.d / 2);
    this.mesh.renderOrder = ORDER.floor;
  }

  set(field: world3d.Field, view: AirView): void {
    const { cols, rows, values } = field;
    const { lo, hi } = world3d.AIR_SCALES[view === "outlet" ? "outlet" : "inlet"];
    this.small.width = cols;
    this.small.height = rows;
    const g = this.small.getContext("2d") as CanvasRenderingContext2D;
    const img = g.createImageData(cols, rows);
    for (let i = 0; i < values.length; i++) {
      const [r, gr, b] = rgb255(world3d.airColor(view, values[i] as number));
      img.data[i * 4] = r;
      img.data[i * 4 + 1] = gr;
      img.data[i * 4 + 2] = b;
      // Cool air is a thin tint (the tiles show through), hot air is a strong one.
      const n = ((values[i] as number) - lo) / (hi - lo);
      img.data[i * 4 + 3] = Math.round(255 * (0.3 + 0.7 * Math.min(1, Math.max(0, n))));
    }
    g.putImageData(img, 0, 0);
    const k = Math.max(1, Math.min(UPSCALE, Math.floor(MAX_TEXTURE_PX / Math.max(cols, rows))));
    this.big.width = cols * k;
    this.big.height = rows * k;
    const b = this.big.getContext("2d") as CanvasRenderingContext2D;
    b.imageSmoothingEnabled = true;
    b.imageSmoothingQuality = "high";
    b.drawImage(this.small, 0, 0, this.big.width, this.big.height);
    this.texture.needsUpdate = true;
    this.material.opacity = view === "flow" ? 0.6 : 0.92;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
  }
}

/** A round glow: white in the middle, clear at the edge. */
function glowTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 64;
  const g = c.getContext("2d") as CanvasRenderingContext2D;
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.55, "rgba(255,255,255,0.7)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** The perforated tiles of the cold aisles, glowing the more the supply reaches them: one mesh, a colour with alpha per corner. */
export class AisleTiles {
  readonly mesh: THREE.Mesh | undefined;
  private readonly spans = new Map<string, readonly [number, number]>();
  private readonly colors: Float32Array;
  private readonly glow: THREE.CanvasTexture;
  private readonly material: THREE.MeshBasicMaterial;

  constructor(scene: RoomScene) {
    const positions: number[] = [];
    const uvs: number[] = [];
    const index: number[] = [];
    let v = 0;
    const y = scene.floorY + LIFT_M * 1.5;
    for (const pod of scene.pods) {
      if (pod.aisle !== "cold") continue;
      const e = pod.enclosure;
      const nx = Math.max(1, Math.floor((e.x1 - e.x0) / TILE_M));
      const nz = Math.max(1, Math.floor((e.z1 - e.z0) / TILE_M));
      const sx = (e.x1 - e.x0) / nx;
      const sz = (e.z1 - e.z0) / nz;
      const first = v;
      for (let j = 0; j < nz; j++)
        for (let i = 0; i < nx; i++) {
          const x0 = e.x0 + i * sx + 0.02;
          const z0 = e.z0 + j * sz + 0.02;
          const x1 = e.x0 + (i + 1) * sx - 0.02;
          const z1 = e.z0 + (j + 1) * sz - 0.02;
          // A quad a little larger than its tile, so the round glows of neighbours run into each other.
          const px = (x1 - x0) * 0.15;
          const pz = (z1 - z0) * 0.15;
          positions.push(
            x0 - px,
            y,
            z0 - pz,
            x1 + px,
            y,
            z0 - pz,
            x1 + px,
            y,
            z1 + pz,
            x0 - px,
            y,
            z1 + pz,
          );
          uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
          index.push(v, v + 2, v + 1, v, v + 3, v + 2);
          v += 4;
        }
      this.spans.set(pod.id, [first, v]);
    }
    this.colors = new Float32Array(v * 4);
    this.glow = glowTexture();
    this.material = new THREE.MeshBasicMaterial({
      map: this.glow,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    if (v === 0) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geo.setAttribute("color", new THREE.BufferAttribute(this.colors, 4));
    geo.setIndex(index);
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.renderOrder = ORDER.tiles;
    this.mesh.frustumCulled = false;
  }

  /** `reach` per cold aisle, 0..1: the further the supply reaches, the brighter the tiles. */
  set(reach: ReadonlyMap<string, number>): void {
    for (const [id, [from, to]] of this.spans) {
      const alpha = 0.35 + 0.6 * (reach.get(id) ?? 0);
      for (let k = from; k < to; k++)
        this.colors.set([COLD_TILE.r, COLD_TILE.g, COLD_TILE.b, alpha], k * 4);
    }
    const attribute = this.mesh?.geometry.getAttribute("color");
    if (attribute) attribute.needsUpdate = true;
  }

  dispose(): void {
    this.mesh?.removeFromParent();
    this.mesh?.geometry.dispose();
    this.material.dispose();
    this.glow.dispose();
  }
}

/** A thin tinted door on the front of each rack that has one (a tank has none). */
export class Doors {
  readonly mesh: THREE.InstancedMesh | undefined;
  private readonly material = new THREE.MeshBasicMaterial({ color: "#ffffff" });
  private readonly rackIds: string[] = [];
  private readonly geometry = new THREE.PlaneGeometry(1, 1);

  constructor(scene: RoomScene, racks: ReadonlyArray<world3d.RackSpot>) {
    const placed = racks.filter((r) => r.form !== "tank");
    if (placed.length === 0) return;
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, placed.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    placed.forEach((r, i) => {
      const turn = Math.atan2(r.fx, r.fz);
      const reach = r.d / 2 + 0.012;
      m.compose(
        new THREE.Vector3(r.x + r.fx * reach, scene.floorY + r.h / 2, r.z + r.fz * reach),
        q.setFromAxisAngle(up, turn),
        new THREE.Vector3(r.w - 0.1, r.h - 0.25, 1),
      );
      this.mesh?.setMatrixAt(i, m);
      this.rackIds.push(r.id);
    });
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(placed.length * 3),
      3,
    );
    this.mesh.frustumCulled = false;
  }

  set(view: AirView, racks: ReadonlyArray<world3d.RackSpot>): void {
    const mesh = this.mesh;
    if (!mesh?.instanceColor) return;
    const byId = new Map(racks.map((r) => [r.id, r]));
    this.rackIds.forEach((id, i) => {
      const rack = byId.get(id);
      if (rack) mesh.instanceColor?.setXYZ(i, ...world3d.doorColor(view, rack));
    });
    mesh.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    this.mesh?.removeFromParent();
    this.mesh?.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }
}

/** A flat frame under the rack that was picked, so it can be found in a hall of hundreds. */
export class PickRing {
  readonly mesh: THREE.Mesh;
  private readonly material = new THREE.MeshBasicMaterial({
    color: "#2f6dc0",
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  });
  private readonly floorY: number;

  constructor(scene: RoomScene) {
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.material);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.visible = false;
    this.mesh.renderOrder = ORDER.ring;
    this.floorY = scene.floorY;
  }

  show(rack: world3d.RackSpot | undefined): void {
    this.mesh.visible = rack !== undefined;
    if (!rack) return;
    const turn = Math.atan2(rack.fx, rack.fz);
    this.mesh.position.set(rack.x, this.floorY + LIFT_M * 2.5, rack.z);
    this.mesh.rotation.set(-Math.PI / 2, 0, turn);
    this.mesh.scale.set(rack.w + 0.5, rack.d + 0.9, 1);
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

export type { Airflow };
