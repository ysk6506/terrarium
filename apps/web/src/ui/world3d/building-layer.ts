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
import { buildRoom } from "./room-layer";
import { roomPicks } from "./room-picks";
import { tween } from "./tween";

type BuildingInfo = world3d.BuildingInfo;
type BuildingScene = world3d.BuildingScene;
type FloorScene = world3d.FloorScene;

const { ROOM_HEIGHT_M } = world3d;
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
  /** Perimeter, room walls and containment. */
  readonly cover: THREE.Object3D;
  readonly rooms: ReadonlyMap<string, THREE.Object3D>;
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
  shell(cover, scene.w, scene.d, f.height);
  const group = new THREE.Group();
  const rooms = new Map<string, THREE.Object3D>();
  for (const room of f.rooms) {
    buildRoom({ k, cover, fleet }, room);
    const s = room.scene;
    const proxy = proxyBox(
      { kind: "room", id: room.id },
      [room.x + s.w / 2, ROOM_HEIGHT_M / 2, room.z + s.d / 2],
      [s.w, ROOM_HEIGHT_M, s.d],
    );
    rooms.set(room.id, proxy);
    group.add(proxy);
  }
  fleet.build();
  const roofs = covers.bake();
  group.add(b.bake(), roofs, fleet.group);
  return { scene: f, group, fleet, cover: roofs, rooms };
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
            ? [...f.rooms].filter(([id]) => id !== this.openRoom).map(([, o]) => o)
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
    for (const f of this.floors) f.cover.visible = on;
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
