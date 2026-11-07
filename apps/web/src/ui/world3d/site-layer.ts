/**
 * The site layer: the land with its roads, fence, gate, buildings, plant yards, trees and cars, built
 * once from a `SiteScene` into a few dozen draw calls (REQ-006, REQ-036). Buildings and yards get
 * unseen proxy boxes so a click lands on them whole.
 */
import * as THREE from "three";
import { world3d } from "../../logic";
import { Baker } from "./baker";
import { buildingShell } from "./building-shell";
import { drawCampus } from "./campus-layer";
import type { Engine } from "./engine";
import { type Layer, makeLayer, proxyBox } from "./layer";

/** The site layer, with each building in a group of its own so one can be hidden when it is opened. */
export interface SiteLayer extends Layer {
  setBuildingHidden(id: string, hidden: boolean): void;
}

import { type Kit, pylon, yardItemPart } from "./parts";
import { cars, trees } from "./scatter-layer";
import { fence, gate, landMesh, parcels, parking, roads } from "./site-ground";

type SiteScene = world3d.SiteScene;
type Yard = world3d.Yard;

function yardPlant(k: Kit, yard: Yard): void {
  const { b, m } = k;
  const a = yard.area;
  b.box(m.concrete, {
    x: (a.x0 + a.x1) / 2,
    z: (a.z0 + a.z1) / 2,
    w: a.x1 - a.x0,
    d: a.z1 - a.z0,
    h: 0.2,
    tile: 32,
    shadow: false,
  });
  for (const item of yard.items)
    yardItemPart(
      k,
      item.style,
      { x: item.x, z: item.z, w: item.w, d: item.d, rot: item.rot },
      item.look,
    );
}

/** Wires between two pylon tops, sagging, as line segments. */
function wires(from: THREE.Vector3, to: THREE.Vector3, into: number[]): void {
  const steps = 12;
  let prev = from.clone();
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const p = from.clone().lerp(to, t);
    p.y -= Math.sin(t * Math.PI) * 2.4;
    into.push(prev.x, prev.y, prev.z, p.x, p.y, p.z);
    prev = p;
  }
}

const PYLON_H = 22;
const SPAN_M = 80;

const inside = (p: { x: number; z: number }, b: world3d.Bounds, margin: number): boolean =>
  p.x > b.x0 - margin && p.x < b.x1 + margin && p.z > b.z0 - margin && p.z < b.z1 + margin;

/** The grid feeder: from the most northerly power yard, a line of pylons carrying three wires a side. */
function grid(k: Kit, site: SiteScene, group: THREE.Group): void {
  const power = site.yards.filter((y) => y.kind === "power");
  const yard = power.reduce<Yard | undefined>(
    (a, y) => (a && a.area.z0 <= y.area.z0 ? a : y),
    undefined,
  );
  if (!yard) return;
  const x = (yard.area.x0 + yard.area.x1) / 2;
  const taken = [...site.buildings.map(world3d.boundsOfBox), ...site.yards.map((y) => y.area)];
  const towers: THREE.Vector3[] = [];
  for (let i = 0; i < 4; i++) {
    const p = { x, z: yard.area.z0 - 22 - i * SPAN_M };
    if (taken.some((b) => inside(p, b, 8))) break;
    towers.push(new THREE.Vector3(p.x, 0, p.z));
    pylon(k, p.x, p.z, PYLON_H);
  }
  const points: number[] = [];
  for (let i = 1; i < towers.length; i++)
    for (const dy of [PYLON_H - 3, PYLON_H - 8])
      for (const dx of [-9, 9])
        wires(
          new THREE.Vector3(x + dx, dy, (towers[i - 1] as THREE.Vector3).z),
          new THREE.Vector3(x + dx, dy, (towers[i] as THREE.Vector3).z),
          points,
        );
  if (points.length === 0) return;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
  group.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: "#3a3f46" })));
}

export function buildSiteLayer(engine: Engine, site: SiteScene): SiteLayer {
  const group = new THREE.Group();
  const b = new Baker();
  const k: Kit = { b, m: engine.mats };
  group.add(landMesh(engine.mats, site.outline));
  roads(k, site);
  parking(k, site);
  drawCampus(k, site.campus);
  fence(k, site.outline);
  gate(k, site.gate);
  parcels(k, site);
  const shells = new Map<string, THREE.Group>();
  for (const building of site.buildings) {
    const own = new Baker();
    buildingShell({ b: own, m: engine.mats }, building);
    const shell = own.bake();
    shells.set(building.id, shell);
    group.add(shell);
  }
  for (const yard of site.yards) yardPlant(k, yard);
  group.add(
    ...trees(engine.mats, [
      ...world3d.treesAt(site.plan.trees, engine.quality.name),
      ...site.campus.trees,
    ]),
    ...cars(engine.mats, [...site.lots, ...site.campus.lots]),
  );
  grid(k, site, group);
  group.add(b.bake());
  const pickables: THREE.Object3D[] = [];
  for (const bi of site.buildings)
    pickables.push(
      proxyBox(
        { kind: "building", id: bi.id },
        [bi.x, (bi.height + 0.5) / 2, bi.z],
        [bi.w, bi.height + 0.5, bi.d],
        bi.rot,
      ),
    );
  for (const y of site.yards) {
    const a = y.area;
    pickables.push(
      proxyBox(
        { kind: "yard", id: y.id },
        [(a.x0 + a.x1) / 2, 4, (a.z0 + a.z1) / 2],
        [a.x1 - a.x0, 8, a.z1 - a.z0],
      ),
    );
  }
  for (const p of site.parcels)
    pickables.push(
      proxyBox(
        { kind: "parcel", id: p.id },
        [(p.area.x0 + p.area.x1) / 2, 3, (p.area.z0 + p.area.z1) / 2],
        [p.area.x1 - p.area.x0, 6, p.area.z1 - p.area.z0],
      ),
    );
  group.add(...pickables);
  const hidden = new Set<string>();
  const base = makeLayer(group, pickables);
  return {
    group,
    get pickables() {
      return pickables.filter((o) => !hidden.has((o.userData.pick as { id: string }).id));
    },
    dispose: base.dispose,
    setBuildingHidden: (id, hide) => {
      const shell = shells.get(id);
      if (shell) shell.visible = !hide;
      if (hide) hidden.add(id);
      else hidden.delete(id);
    },
  };
}
