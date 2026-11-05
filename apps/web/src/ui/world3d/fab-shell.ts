/**
 * A semiconductor fab seen from outside (REQ-006, REQ-043): a vast, nearly windowless block of ribbed
 * pale panels with a dark base stripe and a blue band under the parapet, big louvred walls, truck docks
 * at the back, a pipe bridge reaching out to the utility yard, and a big blue roof — the colour fabs
 * have from the air — crowded with exhaust stacks, scrubbers and make-up air units. Drawn from the idea of a fab, not from any real building's plans.
 */
import type { world3d } from "../../logic";
import type { Kit } from "./parts";

type BuildingInfo = world3d.BuildingInfo;

const BASE_M = 0.5;

/** The slab, the walls, the stripes at foot and head, and a trim line at every floor. */
function body(k: Kit, info: BuildingInfo): void {
  const { b, m } = k;
  const { w, d, height } = info;
  b.box(m.concrete, { x: 0, z: 0, w: w + 6, d: d + 6, h: BASE_M, tile: 32 });
  b.box(m.wallFab, { x: 0, z: 0, w, d, h: height, y: BASE_M, round: 0.4, tile: 24 });
  b.box(m.solid("#34588a", 0.8, 0), {
    x: 0,
    z: 0,
    w: w + 0.3,
    d: d + 0.3,
    h: 1.2,
    y: BASE_M,
    shadow: false,
  });
  b.box(m.solid("#9cc7de", 0.7, 0), {
    x: 0,
    z: 0,
    w: w + 0.3,
    d: d + 0.3,
    h: 1.6,
    y: BASE_M + height - 2.6,
    shadow: false,
  });
  for (let f = 1; f < info.floors; f++)
    b.box(m.trim, { x: 0, z: 0, w: w + 0.4, d: d + 0.4, h: 0.3, y: BASE_M + f * info.floorH });
}

/** Louvred plant walls on the long faces, truck docks at the back, a glass entrance at the front. */
function faces(k: Kit, info: BuildingInfo): void {
  const { b, m } = k;
  const { w, d, height } = info;
  const spans = Math.max(1, Math.min(4, Math.floor(w / 40)));
  const span = Math.min(26, (w - 20) / spans);
  for (let i = 0; i < spans; i++) {
    const x = -w / 2 + 14 + span / 2 + i * ((w - 28 - span) / Math.max(1, spans - 1));
    for (const sz of [-1, 1])
      b.box(m.wallLouvre, {
        x,
        z: sz * (d / 2 + 0.08),
        w: span,
        d: 0.2,
        h: height * 0.45,
        y: BASE_M + 2.6,
        tile: 12,
        shadow: false,
      });
  }
  const docks = Math.min(7, Math.floor(w / 22));
  for (let i = 0; i < docks; i++) {
    const x = -w / 2 + 12 + i * ((w - 24) / Math.max(1, docks - 1));
    b.box(m.dark, { x, z: -d / 2 - 0.06, w: 5, d: 0.14, h: 4, y: BASE_M, shadow: false });
    b.box(m.trim, { x, z: -d / 2 - 1.4, w: 6, d: 2.8, h: 0.3, y: BASE_M + 4.4 });
  }
  const door = Math.min(16, w * 0.14);
  b.box(m.glass, {
    x: -w / 2 + 14,
    z: d / 2 + 1.4,
    w: door,
    d: 2.8,
    h: 3.6,
    y: BASE_M,
    shadow: false,
  });
  b.box(m.trim, { x: -w / 2 + 14, z: d / 2 + 1.6, w: door + 1.4, d: 3.4, h: 0.4, y: BASE_M + 4.4 });
  for (const sx of [-1, 1])
    b.box(m.glass, {
      x: sx * (w / 2 + 0.05),
      z: d * 0.3,
      w: 0.1,
      d: 1.2,
      h: height * 0.7,
      y: BASE_M + 2,
      shadow: false,
    });
}

/** Three pipes on posts reaching out from the side wall toward the utility yard. */
function pipeBridge(k: Kit, info: BuildingInfo): void {
  const { b, m } = k;
  const { w } = info;
  const reach = 22;
  const mats = [m.supply, m.returning, m.power];
  for (const [i, mat] of mats.entries())
    b.pipe(
      mat,
      [w / 2, 8 + i * 0.7, -4 + i * 1.6],
      [w / 2 + reach, 8 + i * 0.7, -4 + i * 1.6],
      0.28,
    );
  for (let x = 6; x <= reach; x += 7) {
    b.box(m.steel, { x: w / 2 + x, z: -2.6, w: 0.5, d: 0.5, h: 8.2, y: 0 });
    b.box(m.steel, { x: w / 2 + x, z: -2.6, w: 0.5, d: 3.6, h: 0.3, y: 8.2 });
  }
}

/** Exhaust stacks, scrubbers, make-up air units and a penthouse on the roof. */
function roofPlant(k: Kit, info: BuildingInfo): void {
  const { b, m } = k;
  const { w, d } = info;
  const top = BASE_M + info.height;
  b.box(m.roofFab, { x: 0, z: 0, w: w - 0.2, d: d - 0.2, h: 0.25, y: top, tile: 6 });
  for (const [x, z, pw, pd] of [
    [0, d / 2, w + 0.5, 0.5],
    [0, -d / 2, w + 0.5, 0.5],
    [w / 2, 0, 0.5, d],
    [-w / 2, 0, 0.5, d],
  ] as const)
    b.box(m.trim, { x, z, w: pw, d: pd, h: 1, y: top, round: 0.1 });
  const y = top + 0.25;
  b.box(m.wallFab, { x: 0, z: d * 0.08, w: w * 0.5, d: d * 0.3, h: 5.5, y, round: 0.3, tile: 16 });
  b.box(m.wallLouvre, {
    x: 0,
    z: d * 0.08 + d * 0.15 + 0.05,
    w: w * 0.4,
    d: 0.14,
    h: 3.4,
    y: y + 1,
    tile: 8,
    shadow: false,
  });
  const stacks = Math.max(3, Math.min(9, Math.floor(w / 18)));
  for (let i = 0; i < stacks; i++) {
    const x = -w / 2 + 10 + i * ((w - 20) / (stacks - 1));
    b.cyl(m.galv, { x, z: -d * 0.3, r: 1.4, top: 1.1, h: 12, y, seg: 16 });
    b.cyl(m.white, { x, z: -d * 0.3, r: 1.7, top: 1.7, h: 0.4, y: y + 12, seg: 16, shadow: false });
  }
  const scrubbers = Math.min(6, Math.floor(w / 28));
  for (let i = 0; i < scrubbers; i++) {
    const x = -w / 2 + 14 + i * ((w - 28) / Math.max(1, scrubbers - 1));
    b.cyl(m.white, { x, z: d * 0.38, r: 2.2, h: 7, y, seg: 18 });
    b.cyl(m.tower, { x, z: d * 0.38, r: 2.25, h: 0.7, y: y + 5, seg: 18, shadow: false });
  }
  const units = Math.min(8, Math.floor(w / 20));
  for (let i = 0; i < units; i++) {
    const x = -w / 2 + 12 + i * ((w - 24) / Math.max(1, units - 1));
    b.box(m.white, { x, z: -d * 0.12, w: 8, d: 4.5, h: 3, y, round: 0.2 });
    b.box(m.dark, { x, z: -d * 0.12 + 2.3, w: 6.4, d: 0.1, h: 2, y: y + 0.5, shadow: false });
  }
}

/** Build one fab into the baker, in its own frame. */
export function fabShell(k: Kit, info: BuildingInfo): void {
  const { b } = k;
  b.frame(info.x, info.z, info.rot, () => {
    body(k, info);
    faces(k, info);
    pipeBridge(k, info);
    roofPlant(k, info);
  });
}
