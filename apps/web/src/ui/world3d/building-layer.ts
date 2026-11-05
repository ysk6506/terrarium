/**
 * A building opened like a dollhouse (REQ-006, REQ-043): the roof is off and each floor stands apart
 * from the next, with its rooms laid out inside a glass perimeter. A room is a click away from being
 * the focus. Floors above the room being studied can be hidden, and the gap between floors closes
 * when the viewer steps into a room.
 */
import * as THREE from "three";
import { world3d } from "../../logic";
import { Baker } from "./baker";
import type { Engine } from "./engine";
import { proxyBox } from "./layer";
import type { Kit } from "./parts";
import { RackFleet } from "./racks-layer";
import { bakePods, buildRoom } from "./room-layer";
import { roomPicks } from "./room-picks";
import { tween } from "./tween";

type BuildingInfo = world3d.BuildingInfo;
type BuildingScene = world3d.BuildingScene;
type FloorScene = world3d.FloorScene;

const { ROOM_HEIGHT_M } = world3d;
/** The camera walks into an aisle in this long, and the roof clears in step, ms. */
const WALK_IN_MS = world3d.WALK_IN_S * 1000;
const CURB_M = 1;
const EDGE_M = 0.35;

export interface BuildingLayer {
  readonly group: THREE.Group;
  readonly pickables: THREE.Object3D[];
  /** Spread the floors apart (1) or stack them (0), gliding. */
  setExplode(amount: number, ms?: number): void;
  /** How far floor `index` (0 = ground floor) is lifted by the spreading now, metres. */
  liftOf(index: number): number;
  /** Show floors up to this index (0 = ground floor); undefined shows all. */
  showFloorsTo(index: number | undefined): void;
  /** Let only this floor's rooms catch clicks (the floor being worked on); undefined lets all. */
  setPickFloor(index: number | undefined): void;
  /** Show or take away the walls, glass and containment around the racks (a rack is looked at without them). */
  showContainment(on: boolean): void;
  /** Look into a containment: its roof and doors go clear while the camera walks in; false if no floor has it. */
  enterPod(roomId: string, podId: string): boolean;
  /** The roof and doors of the containment that was looked into come back. */
  leavePod(): void;
  /** The room whose volume should not catch clicks (the one being looked into). */
  setOpenRoom(roomId: string | undefined): void;
  recolor(layer: world3d.Layer, overlay: world3d.Overlay): void;
  /** Put an object in a room's own frame (its corner at the origin, y up from the slab); false if no floor has the room. */
  mountInRoom(roomId: string, object: THREE.Object3D): boolean;
  /** Hide one rack's instance (it is drawn in detail) or bring it back. */
  setRackHidden(id: string, hidden: boolean): void;
  /** A rack's place in world space, once the building is on screen. */
  rackWorld(id: string): THREE.Vector3 | undefined;
  /** Clear the racks in front of one; returns how to bring them back. */
  clearFrontOf(id: string): () => void;
  /** Put an object where a rack stands, turned as the rack is, inside its floor. Returns where the rack faces in world space (radians). */
  mountOnRack(id: string, object: THREE.Object3D): number | undefined;
  dispose(): void;
}

interface Floor {
  readonly scene: FloorScene;
  readonly group: THREE.Group;
  readonly fleet: RackFleet;
  /** Perimeter and room walls. */
  readonly cover: THREE.Object3D;
  /** Roofs, doors and posts of the containments; made again when one is looked into. */
  pods: THREE.Object3D;
  /** One unseen box to click for each rectangle of the room. */
  readonly rooms: ReadonlyMap<string, readonly THREE.Object3D[]>;
}

/** The slab a floor stands on. */
function slab(k: Kit, w: number, d: number): void {
  const { b, m } = k;
  b.box(m.concrete, {
    x: w / 2,
    z: d / 2,
    w: w + EDGE_M * 2,
    d: d + EDGE_M * 2,
    h: 0.4,
    y: -0.4,
    tile: 8,
  });
}

/** Curb, glass and corner posts around one floor. */
function shell(k: Kit, w: number, d: number, height: number): void {
  const { b, m } = k;
  const runs: ReadonlyArray<readonly [number, number, number, number]> = [
    [w / 2, -EDGE_M / 2, w + EDGE_M * 2, EDGE_M],
    [w / 2, d + EDGE_M / 2, w + EDGE_M * 2, EDGE_M],
    [-EDGE_M / 2, d / 2, EDGE_M, d],
    [w + EDGE_M / 2, d / 2, EDGE_M, d],
  ];
  for (const [x, z, rw, rd] of runs) {
    b.box(m.wall, { x, z, w: rw, d: rd, h: CURB_M, tile: 16 });
    b.box(m.glassPane, { x, z, w: rw, d: rd * 0.4, h: height - CURB_M, y: CURB_M, shadow: false });
  }
  for (const [x, z] of [
    [-EDGE_M / 2, -EDGE_M / 2],
    [w + EDGE_M / 2, -EDGE_M / 2],
    [-EDGE_M / 2, d + EDGE_M / 2],
    [w + EDGE_M / 2, d + EDGE_M / 2],
  ] as const)
    b.box(m.trim, { x, z, w: 0.6, d: 0.6, h: height, round: 0.05 });
}

function buildFloor(engine: Engine, scene: BuildingScene, f: FloorScene): Floor {
  const b = new Baker();
  const covers = new Baker();
  const fleet = new RackFleet(engine.mats);
  const k: Kit = { b, m: engine.mats };
  const cover: Kit = { b: covers, m: engine.mats };
  slab(k, scene.w, scene.d);
  for (const r of f.bare)
    k.b.box(k.m.freeFloor, {
      x: r.x + r.w / 2,
      z: r.y + r.d / 2,
      w: r.w,
      d: r.d,
      h: 0.05,
      shadow: false,
    });
  shell(cover, scene.w, scene.d, f.height);
  const group = new THREE.Group();
  const rooms = new Map<string, THREE.Object3D[]>();
  for (const room of f.rooms) {
    buildRoom({ k, cover, fleet }, room);
    const s = room.scene;
    // A room made of pieces is clicked on any of them.
    const proxies = world3d
      .rectsOfScene(s)
      .map((r) =>
        proxyBox(
          { kind: "room", id: room.id },
          [room.x + (r.x0 + r.x1) / 2, ROOM_HEIGHT_M / 2, room.z + (r.z0 + r.z1) / 2],
          [r.x1 - r.x0, ROOM_HEIGHT_M, r.z1 - r.z0],
        ),
      );
    rooms.set(room.id, proxies);
    for (const proxy of proxies) group.add(proxy);
  }
  fleet.build();
  const roofs = covers.bake();
  const pods = bakePods({ b: new Baker(), m: engine.mats }, f.rooms);
  group.add(b.bake(), roofs, pods, fleet.group);
  return { scene: f, group, fleet, cover: roofs, pods, rooms };
}

/** The floors of one building, stacked or spread apart. */
class Stack implements BuildingLayer {
  readonly group = new THREE.Group();
  private readonly floors: Floor[];
  private amount = 0;
  private openRoom: string | undefined;
  private pickFloor: number | undefined;
  /** The containments and equipment of the open room, as unseen boxes to click. */
  private inner: THREE.Object3D | undefined;
  private stopTween = () => {};
  /** Whether walls and containment are shown, and the containment being looked into. */
  private coverOn = true;
  private entered?: {
    readonly floor: Floor;
    readonly mine: THREE.Object3D;
    readonly faded: THREE.MeshStandardMaterial[];
    readonly stop: () => void;
  };

  constructor(
    private readonly engine: Engine,
    private readonly info: BuildingInfo,
    scene: BuildingScene,
    private readonly explodeM: number,
  ) {
    this.group.position.set(info.x, 0, info.z);
    this.group.rotation.y = info.rot;
    const frame = new THREE.Group();
    frame.position.set(-scene.w / 2, 0, -scene.d / 2);
    this.group.add(frame);
    this.floors = scene.floors.map((f) => buildFloor(engine, scene, f));
    for (const f of this.floors) frame.add(f.group);
    this.place();
  }

  private place(): void {
    for (const [i, f] of this.floors.entries())
      f.group.position.y = f.scene.y + this.amount * this.explodeM * i;
    this.engine.invalidate();
  }

  get pickables(): THREE.Object3D[] {
    return [
      ...this.floors
        .filter((_, i) => this.pickFloor === undefined || i === this.pickFloor)
        .flatMap((f) => [
          ...f.fleet.pickables,
          ...(f.group.visible
            ? [...f.rooms].filter(([id]) => id !== this.openRoom).flatMap(([, o]) => o)
            : []),
        ]),
      ...(this.inner?.children ?? []),
    ];
  }

  liftOf(index: number): number {
    return this.amount * this.explodeM * index;
  }

  setExplode(to: number, ms = 700): void {
    this.stopTween();
    this.stopTween = tween(this.engine, this.amount, to, ms, (v) => {
      this.amount = v;
      this.place();
    });
  }

  showFloorsTo(index: number | undefined): void {
    for (const [i, f] of this.floors.entries()) f.group.visible = index === undefined || i <= index;
    this.engine.invalidate();
  }

  setPickFloor(index: number | undefined): void {
    this.pickFloor = index;
  }

  showContainment(on: boolean): void {
    this.coverOn = on;
    for (const f of this.floors) f.cover.visible = f.pods.visible = on;
    if (this.entered) this.entered.mine.visible = on;
    this.engine.invalidate();
  }

  /** The roofs and doors of a floor's containments, made again without the one being looked into. */
  private remakePods(f: Floor, except?: string): void {
    f.pods.removeFromParent();
    f.pods.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    f.pods = bakePods({ b: new Baker(), m: this.engine.mats }, f.scene.rooms, { except });
    f.pods.visible = this.coverOn;
    f.group.add(f.pods);
  }

  enterPod(roomId: string, podId: string): boolean {
    const f = this.floors.find((x) => x.scene.rooms.some((r) => r.id === roomId));
    if (!f) return false;
    this.leavePod();
    this.remakePods(f, podId);
    const rooms = f.scene.rooms.filter((r) => r.id === roomId);
    const mine = bakePods({ b: new Baker(), m: this.engine.mats }, rooms, { only: podId });
    const faded: THREE.MeshStandardMaterial[] = [];
    const base: number[] = [];
    mine.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const own = (mesh.material as THREE.MeshStandardMaterial).clone();
      mesh.material = own;
      faded.push(own);
      base.push(own.opacity);
    });
    mine.visible = this.coverOn;
    f.group.add(mine);
    const stop = tween(this.engine, 1, 0.2, WALK_IN_MS, (v) =>
      faded.forEach((m, i) => {
        m.opacity = (base[i] as number) * v;
      }),
    );
    this.entered = { floor: f, mine, faded, stop };
    return true;
  }

  leavePod(): void {
    const e = this.entered;
    if (!e) return;
    this.entered = undefined;
    e.stop();
    e.mine.removeFromParent();
    e.mine.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    for (const m of e.faded) m.dispose();
    this.remakePods(e.floor);
    this.engine.invalidate();
  }

  setOpenRoom(id: string | undefined): void {
    if (id === this.openRoom) return;
    this.openRoom = id;
    this.inner?.removeFromParent();
    this.inner = undefined;
    for (const f of this.floors) {
      const room = id ? f.scene.rooms.find((r) => r.id === id) : undefined;
      if (!room) continue;
      this.inner = roomPicks(room.scene);
      this.inner.position.set(room.x, 0, room.z);
      f.group.add(this.inner);
    }
  }

  recolor(layer: world3d.Layer, overlay: world3d.Overlay): void {
    for (const f of this.floors) f.fleet.recolor(layer, overlay);
    this.engine.invalidate();
  }

  setRackHidden(id: string, hidden: boolean): void {
    for (const f of this.floors) f.fleet.setHidden(id, hidden);
    this.engine.invalidate();
  }

  rackWorld(id: string): THREE.Vector3 | undefined {
    this.group.updateWorldMatrix(true, true);
    for (const f of this.floors) {
      const p = f.fleet.position(id);
      if (p) return f.group.localToWorld(p);
    }
    return undefined;
  }

  clearFrontOf(id: string): () => void {
    const undo = this.floors.map((f) => f.fleet.hideInFront(id));
    this.engine.invalidate();
    return () => {
      for (const u of undo) u();
      this.engine.invalidate();
    };
  }

  mountInRoom(roomId: string, object: THREE.Object3D): boolean {
    for (const f of this.floors) {
      const room = f.scene.rooms.find((r) => r.id === roomId);
      if (!room) continue;
      object.position.set(room.x, 0, room.z);
      f.group.add(object);
      this.engine.invalidate();
      return true;
    }
    return false;
  }

  mountOnRack(id: string, object: THREE.Object3D): number | undefined {
    for (const f of this.floors) {
      const at = f.fleet.placement(id);
      if (!at) continue;
      object.position.copy(at.position);
      object.rotation.y = at.rot;
      f.group.add(object);
      return at.rot + this.info.rot;
    }
    return undefined;
  }

  dispose(): void {
    this.stopTween();
    this.group.removeFromParent();
    for (const f of this.floors) {
      f.fleet.dispose();
      f.group.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    }
  }
}

export const buildBuildingLayer = (
  engine: Engine,
  info: BuildingInfo,
  scene: BuildingScene,
  explodeM: number,
): BuildingLayer => new Stack(engine, info, scene, explodeM);
