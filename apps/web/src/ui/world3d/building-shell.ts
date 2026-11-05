/**
 * A data-centre building seen from outside: plinth, cladding with a seam every two metres, floor bands,
 * a glass lobby, a gravel roof with parapet, hatches, a stair core and — when the building is cooled
 * by water — rows of dry coolers on the roof. The cladding says something about the cooling inside
 * (plain for air, louvred for liquid, warm grey for both), so the campus can be read at a glance.
 */
import type { world3d } from "../../logic";
import { fabShell } from "./fab-shell";
import type { Materials } from "./materials";
import { dryCooler, type Kit } from "./parts";

type BuildingInfo = world3d.BuildingInfo;

function wallOf(m: Materials, info: BuildingInfo) {
  if (info.purpose === "research") return m.officeWall;
  if (info.modes.some((x) => x === "dlc" || x === "immersion")) return m.wallLouvre;
  return info.modes.includes("hybrid") ? m.wallPlant : m.wall;
}

function lobby(k: Kit, info: BuildingInfo): void {
  const { b, m } = k;
  const width = Math.min(14, info.w * 0.3);
  const x = -info.w / 4;
  b.box(m.glass, { x, z: info.d / 2 + 1.4, w: width, d: 2.8, h: 3.4, y: 0.5, shadow: false });
  b.box(m.trim, { x, z: info.d / 2 + 1.6, w: width + 1.2, d: 3.4, h: 0.4, y: 4.2 });
  ribbons(k, info);
}

/** A band of windows on each floor, on the front and both ends. */
function ribbons(k: Kit, info: BuildingInfo): void {
  const { b, m } = k;
  for (let f = 0; f < info.floors; f++) {
    const y = 0.5 + f * info.floorH + info.floorH * 0.42;
    const h = info.floorH * 0.3;
    b.box(m.glass, {
      x: info.w * 0.17,
      z: info.d / 2 + 0.04,
      w: info.w * 0.56,
      d: 0.08,
      h,
      y,
      shadow: false,
    });
    for (const sx of [-1, 1])
      b.box(m.glass, {
        x: sx * (info.w / 2 + 0.04),
        z: info.d * 0.12,
        w: 0.08,
        d: info.d * 0.5,
        h,
        y,
        shadow: false,
      });
  }
}

function roof(k: Kit, info: BuildingInfo): void {
  const { b, m } = k;
  const top = info.height + 0.5;
  const { w, d } = info;
  // A data-centre roof is pale gravel: only a fab has the blue one, so the two are told apart from the air.
  b.box(m.roofGravel, { x: 0, z: 0, w: w - 0.2, d: d - 0.2, h: 0.25, y: top, tile: 10 });
  const walls: ReadonlyArray<readonly [number, number, number, number]> = [
    [0, d / 2, w + 0.5, 0.5],
    [0, -d / 2, w + 0.5, 0.5],
    [w / 2, 0, 0.5, d],
    [-w / 2, 0, 0.5, d],
  ];
  for (const [x, z, pw, pd] of walls)
    b.box(m.trim, { x, z, w: pw, d: pd, h: 1, y: top, round: 0.1 });
  const hatches = Math.min(6, Math.floor(w / 9));
  for (let i = 0; i < hatches; i++)
    b.box(m.white, {
      x: w / 2 - 6 - i * 4.6,
      z: d / 2 - 6,
      w: 2.4,
      d: 2.4,
      h: 1.1,
      y: top + 0.25,
      round: 0.15,
    });
  b.box(m.wallPlant, {
    x: -w / 2 + 6,
    z: d / 2 - 6,
    w: 5,
    d: 5,
    h: 3.2,
    y: top + 0.25,
    round: 0.2,
    tile: 16,
  });
  const rows = Math.min(info.roofRows, Math.max(0, Math.floor((d - 12) / 9)));
  for (let r = 0; r < rows; r++)
    dryCooler(k, {
      x: 0,
      z: -d / 2 + 6 + r * 9,
      w: Math.max(5, w - 18),
      d: 3.6,
      rot: 0,
      y: top + 0.25,
    });
}

function sides(k: Kit, info: BuildingInfo): void {
  const { b, m } = k;
  const { w, d } = info;
  for (let f = 0; f < info.floors; f++)
    for (let i = 0; i < Math.min(6, Math.floor(d / 9)); i++)
      b.box(m.dark, {
        x: w / 2 + 0.03,
        z: -d / 2 + 6 + i * ((d - 12) / Math.max(1, Math.min(6, Math.floor(d / 9)) - 1)),
        w: 0.1,
        d: 4.4,
        h: 2.6,
        y: 0.5 + f * info.floorH + 1.2,
        shadow: false,
      });
  for (let i = 0; i < 3; i++) {
    const x = -w / 4 + i * 7;
    b.box(m.dark, { x, z: -d / 2 - 0.04, w: 4.6, d: 0.1, h: 3.4, y: 0.5, shadow: false });
    b.box(m.trim, { x, z: -d / 2 - 0.9, w: 5.2, d: 1.8, h: 0.3, y: 4 });
  }
}

/** Build one building into the baker, in its own frame. */
export function buildingShell(k: Kit, info: BuildingInfo): void {
  if (info.purpose === "fab") {
    fabShell(k, info);
    return;
  }
  const { b, m } = k;
  b.frame(info.x, info.z, info.rot, () => {
    b.box(m.concrete, { x: 0, z: 0, w: info.w + 4, d: info.d + 4, h: 0.5, tile: 32 });
    b.box(wallOf(m, info), {
      x: 0,
      z: 0,
      w: info.w,
      d: info.d,
      h: info.height,
      y: 0.5,
      round: 0.35,
      tile: 16,
    });
    for (let f = 1; f < info.floors; f++)
      b.box(m.trim, {
        x: 0,
        z: 0,
        w: info.w + 0.5,
        d: info.d + 0.5,
        h: 0.35,
        y: 0.5 + f * info.floorH,
      });
    lobby(k, info);
    roof(k, info);
    sides(k, info);
  });
}
