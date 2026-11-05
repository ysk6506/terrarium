/**
 * The airflow map of one server room (REQ-072, ADR-0074), laid over the room the 3D view already draws:
 * a soft floor temperature, a tinted front door on every rack, the glowing tiles of the cold aisles, and
 * the air as puffs and arrows that move along their paths — faster and stronger where more air moves.
 * The numbers come from the pure `hallAir.airflowOf`; this file only draws them. In "still" (people who
 * asked their system for less motion) only the arrows are drawn, standing. A machine that cannot keep up gets
 * fewer puffs and arrows (half for each level of strain, never none) and moves them less often, but they keep moving.
 * Nothing here needs a transmission material: they would hide the puffs.
 */
import * as THREE from "three";
import { world3d } from "../../logic";
import { AisleTiles, Doors, HeatPlane, PickRing } from "./airflow-floor";
import { AirMotion } from "./airflow-motion";
import type { Engine } from "./engine";

type Airflow = world3d.Airflow;
type AirView = world3d.AirView;

/** live: the air moves (fewer of it as the machine struggles). still: only the arrows, standing. off: no air at all (the floor and the doors stay). */
export type AirMode = "live" | "still" | "off";

export interface AirStats {
  readonly puffs: number;
  readonly arrows: number;
  /** Milliseconds the layer spent on its last motion update (a moving average). */
  readonly updateMs: number;
}

export interface AirflowLayer {
  /** In the room's own frame: mount it at the room's corner. */
  readonly group: THREE.Group;
  readonly stats: AirStats;
  update(air: Airflow, view: AirView, reach: ReadonlyMap<string, number>): void;
  setMode(mode: AirMode): void;
  /** A plan seen from above: the air is drawn a little stronger there. */
  setTopDown(on: boolean): void;
  setPicked(id: string | undefined): void;
  /** Where a point of the room shows in world space (for the labels). */
  toWorld(x: number, y: number, z: number, out: THREE.Vector3): THREE.Vector3;
  dispose(): void;
}

/** Seconds between two moves of the air at ease: about thirty a second. */
const STEP_S = 1 / 30;

/** The pieces of the layer, already in one group. */
function buildParts(scene: world3d.RoomScene, first: Airflow) {
  const group = new THREE.Group();
  const plane = new HeatPlane(scene);
  const tiles = new AisleTiles(scene);
  const doors = new Doors(scene, first.racks);
  const ring = new PickRing(scene);
  const motion = new AirMotion();
  group.add(plane.mesh, ring.mesh, motion.group);
  if (tiles.mesh) group.add(tiles.mesh);
  if (doors.mesh) group.add(doors.mesh);
  return { group, plane, tiles, doors, ring, motion };
}

export function buildAirflowLayer(
  engine: Engine,
  scene: world3d.RoomScene,
  first: Airflow,
): AirflowLayer {
  const { group, plane, tiles, doors, ring, motion } = buildParts(scene, first);
  const stats = { puffs: 0, arrows: 0, updateMs: 0 };
  let mode: AirMode = "live";
  let clock = 0;
  let since = 0;
  let air = first;

  const draw = () => {
    const started = performance.now();
    motion.setLevel(engine.strain.level);
    stats.puffs = motion.puffs;
    stats.arrows = motion.arrows;
    motion.group.visible = mode !== "off";
    motion.draw(clock, mode === "live", mode === "live");
    stats.updateMs = stats.updateMs * 0.9 + (performance.now() - started) * 0.1;
    engine.invalidate();
  };

  const off = engine.onFrame((dt, time) => {
    clock = time;
    if (mode !== "live") return;
    since += dt;
    if (since < world3d.stepAt(STEP_S, engine.strain.level)) return;
    since = 0;
    draw();
  });

  return {
    group,
    stats,
    update: (next, view, reach) => {
      air = next;
      plane.set(next.field, view);
      doors.set(view, next.racks);
      tiles.set(reach);
      motion.set(next.paths, view, engine.topDown);
      draw();
    },
    setMode: (next) => {
      mode = next;
      draw();
    },
    setTopDown: (on) => {
      motion.setTopDown(on);
      draw();
    },
    setPicked: (id) => {
      ring.show(id ? air.racks.find((r) => r.id === id) : undefined);
      engine.invalidate();
    },
    toWorld: (x, y, z, out) => {
      group.updateWorldMatrix(true, false);
      return out.set(x, y, z).applyMatrix4(group.matrixWorld);
    },
    dispose: () => {
      off();
      group.removeFromParent();
      for (const part of [plane, tiles, doors, ring, motion]) part.dispose();
      engine.invalidate();
    },
  };
}
