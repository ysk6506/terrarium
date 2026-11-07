/**
 * The ground of a site: the land cut to its outline, the roads laid on it with lane marks, the fence
 * around it, the gate, and the land that is still for sale or ready to build on.
 */
import * as THREE from "three";
import type { world3d } from "../../logic";
import type { Materials } from "./materials";
import type { Kit } from "./parts";

type SiteScene = world3d.SiteScene;
type Pt = world3d.Pt;

const SLAB_M = 5;
export const ROAD_H = 0.12;
const DASH_PITCH = 9;
const MAX_POSTS = 1800;

/** The land as a slab with the grass on top, cut to the outline of the plot. */
export function landMesh(m: Materials, outline: readonly Pt[]): THREE.Mesh {
  const shape = new THREE.Shape(outline.map((p) => new THREE.Vector2(p.x, p.z)));
  const geo = new THREE.ExtrudeGeometry(shape, { depth: SLAB_M, bevelEnabled: false });
  geo.rotateX(Math.PI / 2);
  const mesh = new THREE.Mesh(geo, [m.grass, m.slabSide]);
  mesh.receiveShadow = true;
  return mesh;
}

/** Road surface and the dashed centre line of each route. */
export function roads(k: Kit, site: SiteScene): void {
  const { b, m } = k;
  for (const r of site.roads.rects)
    b.box(m.asphalt, {
      x: (r.x0 + r.x1) / 2,
      z: (r.z0 + r.z1) / 2,
      w: r.x1 - r.x0,
      d: r.z1 - r.z0,
      h: ROAD_H,
      tile: 32,
      shadow: false,
    });
  for (const route of site.roads.routes)
    for (let i = 1; i < route.line.length; i++) {
      const a = route.line[i - 1] as Pt;
      const c = route.line[i] as Pt;
      const length = Math.hypot(c.x - a.x, c.z - a.z);
      const angle = -Math.atan2(c.z - a.z, c.x - a.x);
      for (let t = DASH_PITCH / 2; t < length - 2; t += DASH_PITCH)
        b.box(m.mark, {
          x: a.x + ((c.x - a.x) * t) / length,
          z: a.z + ((c.z - a.z) * t) / length,
          w: 3.6,
          d: 0.26,
          h: 0.03,
          y: ROAD_H,
          rot: angle,
          shadow: false,
        });
    }
}

const BAY_LINE = 0.12;

/** The car parks: asphalt with a white line between every two bays and one along the back of each row. */
export function parking(k: Kit, site: SiteScene): void {
  const { b, m } = k;
  for (const lot of site.plan.parking) {
    const a = lot.area;
    b.box(m.asphalt, {
      x: (a.x0 + a.x1) / 2,
      z: (a.z0 + a.z1) / 2,
      w: a.x1 - a.x0,
      d: a.z1 - a.z0,
      h: 0.1,
      tile: 32,
      shadow: false,
    });
    for (const bay of lot.bays) {
      const alongX = lot.along === "x";
      // The line on the bay's far side along the row; bays share lines, so only the next side is drawn.
      b.box(m.mark, {
        x: alongX ? bay.x + bay.w / 2 : bay.x,
        z: alongX ? bay.z : bay.z + bay.d / 2,
        w: alongX ? BAY_LINE : bay.w,
        d: alongX ? bay.d : BAY_LINE,
        h: 0.02,
        y: 0.1,
        shadow: false,
      });
    }
  }
}

function perimeter(outline: readonly Pt[]): number {
  let n = 0;
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i] as Pt;
    const c = outline[(i + 1) % outline.length] as Pt;
    n += Math.hypot(c.x - a.x, c.z - a.z);
  }
  return n;
}

/** A chain-link fence along the boundary: a rail and posts at an even pitch. */
export function fence(k: Kit, outline: readonly Pt[]): void {
  const { b, m } = k;
  const pitch = Math.max(6, perimeter(outline) / MAX_POSTS);
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i] as Pt;
    const c = outline[(i + 1) % outline.length] as Pt;
    const length = Math.hypot(c.x - a.x, c.z - a.z);
    if (length < 1) continue;
    const angle = -Math.atan2(c.z - a.z, c.x - a.x);
    b.box(m.fence, {
      x: (a.x + c.x) / 2,
      z: (a.z + c.z) / 2,
      w: length,
      d: 0.06,
      h: 0.08,
      y: 1.8,
      rot: angle,
      shadow: false,
    });
    for (let t = 0; t <= length; t += pitch)
      b.box(m.fence, {
        x: a.x + ((c.x - a.x) * t) / length,
        z: a.z + ((c.z - a.z) * t) / length,
        w: 0.14,
        d: 0.14,
        h: 2,
        shadow: false,
      });
  }
}

/** A gate house and a barrier arm where the road meets the boundary. */
export function gate(k: Kit, at: Pt): void {
  const { b, m } = k;
  b.box(m.wall, { x: at.x + 7, z: at.z - 7, w: 6, d: 4.5, h: 3.2, round: 0.25, tile: 16 });
  b.box(m.roof, { x: at.x + 7, z: at.z - 7, w: 7, d: 5.5, h: 0.35, y: 3.2, round: 0.15 });
  b.box(m.glass, { x: at.x + 7, z: at.z - 4.7, w: 4.4, d: 0.08, h: 1.3, y: 1.3, shadow: false });
  b.box(m.solid("#d94a3d", 0.5), {
    x: at.x + 2,
    z: at.z - 7,
    w: 8,
    d: 0.18,
    h: 0.18,
    y: 1.1,
    shadow: false,
  });
  b.box(m.dark, { x: at.x + 5.8, z: at.z - 7, w: 0.3, d: 0.3, h: 1.2 });
}

const STAKE = "#ff5a1f";

/** Land for sale is striped with a ghost of what could stand on it; land that is bought is a prepared pad. */
export function parcels(k: Kit, site: SiteScene): void {
  const { b, m } = k;
  for (const p of site.parcels) {
    const w = p.area.x1 - p.area.x0;
    const d = p.area.z1 - p.area.z0;
    const cx = (p.area.x0 + p.area.x1) / 2;
    const cz = (p.area.z0 + p.area.z1) / 2;
    if (p.owned) b.box(m.concrete, { x: cx, z: cz, w, d, h: 0.1, tile: 32, shadow: false });
    else {
      // Wide stripes on big land, so that it still reads as "for sale" from far enough to see the whole site.
      const tile = Math.min(64, Math.max(14, Math.min(w, d) / 6));
      b.box(m.stripedLand, { x: cx, z: cz, w, d, h: 0.08, tile, shadow: false });
      b.box(m.ghost, {
        x: cx,
        z: cz,
        w: w * 0.7,
        d: d * 0.6,
        h: 12,
        y: 0.08,
        round: 0.5,
        shadow: false,
      });
    }
    for (const [x, z] of [
      [p.area.x0, p.area.z0],
      [p.area.x1, p.area.z0],
      [p.area.x0, p.area.z1],
      [p.area.x1, p.area.z1],
    ] as const)
      b.cyl(m.solid(STAKE, 0.5), { x, z, r: 0.18, h: 3.6, seg: 6 });
  }
}
