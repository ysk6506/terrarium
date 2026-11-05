/**
 * The campus around the buildings, drawn (REQ-006, REQ-048): paved aprons, the street grid with its lane
 * marks and lamps, and the things standing in each block. Every piece of the layout is a few boxes and
 * cylinders in the warm matte look of design C; all of it is baked into the site layer's merged meshes.
 */
import type { world3d } from "../../logic";
import { coolingTower, type Kit } from "./parts";
import { ROAD_H } from "./site-ground";

type Piece = world3d.Piece;
type Campus = world3d.Campus;

const APRON_H = 0.06;
const PAD_H = [0.09, 0.07, 0.07] as const;
const DASH_PITCH_M = 12;
const LAMP_H = 7.6;
const CONTAINERS = ["#c0563b", "#2f6aa3", "#d9a13a", "#4a8a5b", "#8b8f94"] as const;
const SCULPTURES = ["#e0742f", "#2f9aa0", "#f2efe6", "#c94f6d"] as const;

function aprons(k: Kit, list: readonly world3d.Bounds[]): void {
  for (const a of list)
    k.b.box(k.m.concrete, {
      x: (a.x0 + a.x1) / 2,
      z: (a.z0 + a.z1) / 2,
      w: a.x1 - a.x0,
      d: a.z1 - a.z0,
      h: APRON_H,
      tile: 32,
      shadow: false,
    });
}

function streets(k: Kit, list: readonly world3d.Street[]): void {
  const { b, m } = k;
  for (const s of list) {
    const a = s.area;
    const x = (a.x0 + a.x1) / 2;
    const z = (a.z0 + a.z1) / 2;
    b.box(m.asphalt, { x, z, w: a.x1 - a.x0, d: a.z1 - a.z0, h: ROAD_H, tile: 32, shadow: false });
    const [from, to] = s.along === "x" ? [a.x0, a.x1] : [a.z0, a.z1];
    for (let t = from + DASH_PITCH_M / 2; t < to - 3; t += DASH_PITCH_M)
      b.box(m.mark, {
        x: s.along === "x" ? t : x,
        z: s.along === "x" ? z : t,
        w: 4.6,
        d: 0.26,
        h: 0.03,
        y: ROAD_H,
        rot: s.along === "x" ? 0 : Math.PI / 2,
        shadow: false,
      });
  }
}

function lamps(k: Kit, list: readonly world3d.Pt[]): void {
  const { b, m } = k;
  for (const p of list) {
    b.cyl(m.dark, { x: p.x, z: p.z, r: 0.14, h: LAMP_H, seg: 6, shadow: false });
    b.box(m.white, { x: p.x, z: p.z, w: 1.8, d: 0.5, h: 0.22, y: LAMP_H, shadow: false });
  }
}

// ── pieces ────────────────────────────────────────────────────────────────────────────────────

type Draw = (k: Kit, p: Piece) => void;

const pad: Draw = ({ b, m }, p) => {
  const mat = [m.concrete, m.lawn, m.earth][p.v] ?? m.concrete;
  b.box(mat, {
    x: p.x,
    z: p.z,
    w: p.w,
    d: p.d,
    h: PAD_H[p.v] ?? 0.08,
    rot: p.rot,
    tile: 32,
    shadow: false,
  });
};

/** Office and dormitory blocks, and the low annexes beside them. */
const slab: Draw = ({ b, m }, p) => {
  const [mat, tile] = [
    [m.officeWall, 11.7],
    [m.dormWall, 12],
    [m.wall, 16],
  ][p.v] ?? [m.wall, 16];
  b.frame(p.x, p.z, p.rot, () => {
    b.box(mat as typeof m.wall, { x: 0, z: 0, w: p.w, d: p.d, h: p.h, tile: tile as number });
    b.box(m.trim, { x: 0, z: 0, w: p.w + 0.6, d: p.d + 0.6, h: 0.5, y: p.h });
    b.box(m.galv, { x: -p.w * 0.25, z: 0, w: 6, d: 4, h: 1.6, y: p.h + 0.5 });
    b.box(m.galv, { x: p.w * 0.2, z: 0.6, w: 4, d: 3, h: 1.2, y: p.h + 0.5 });
    b.box(m.trim, { x: 0, z: p.d / 2 + 1, w: Math.min(10, p.w * 0.5), d: 3, h: 0.35, y: 3.6 });
    b.box(m.glass, { x: 0, z: p.d / 2 + 0.05, w: Math.min(8, p.w * 0.45), d: 0.2, h: 3.2, y: 0.2 });
  });
};

/** A car park: open decks behind a low wall, a stair tower, and pillars. */
const deck: Draw = ({ b, m }, p) => {
  const step = p.h / p.n;
  b.frame(p.x, p.z, p.rot, () => {
    b.box(m.dark, { x: 0, z: 0, w: p.w - 1, d: p.d - 1, h: p.h });
    for (let level = 0; level <= p.n; level++) {
      const y = level * step;
      b.box(m.concrete, { x: 0, z: 0, w: p.w, d: p.d, h: 0.5, y, tile: 32 });
      for (const [x, z, w, d] of [
        [0, p.d / 2 - 0.2, p.w, 0.4],
        [0, -p.d / 2 + 0.2, p.w, 0.4],
        [p.w / 2 - 0.2, 0, 0.4, p.d],
        [-p.w / 2 + 0.2, 0, 0.4, p.d],
      ] as const)
        b.box(m.concrete, { x, z, w, d, h: 1.0, y: y + 0.5, shadow: false });
    }
    for (const sx of [-1, 1])
      for (const sz of [-1, 1])
        b.cyl(m.concrete, {
          x: sx * (p.w / 2 - 1),
          z: sz * (p.d / 2 - 1),
          r: 0.55,
          h: p.h,
          seg: 8,
        });
    b.box(m.wall, {
      x: p.w / 2 - 3.5,
      z: -p.d / 2 + 3.5,
      w: 6,
      d: 6,
      h: p.h + 3,
      round: 0.2,
      tile: 16,
    });
  });
};

/** A hall: the utility plant (louvred) or a warehouse (plain, with dock doors). */
const hall: Draw = ({ b, m }, p) => {
  b.frame(p.x, p.z, p.rot, () => {
    b.box(p.v === 0 ? m.wallLouvre : m.wall, { x: 0, z: 0, w: p.w, d: p.d, h: p.h, tile: 16 });
    b.box(m.roofGravel, { x: 0, z: 0, w: p.w + 0.5, d: p.d + 0.5, h: 0.4, y: p.h, tile: 16 });
    const doors = p.v === 0 ? 2 : Math.max(2, Math.floor(p.w / 10));
    for (let i = 0; i < doors; i++)
      b.box(m.dark, {
        x: (i - (doors - 1) / 2) * (p.w / doors),
        z: p.d / 2 + 0.06,
        w: p.v === 0 ? 5 : 3.2,
        d: 0.2,
        h: p.v === 0 ? 5 : 3.4,
        shadow: false,
      });
    for (let i = 0; i < 3; i++)
      b.box(m.galv, { x: (i - 1) * p.w * 0.28, z: 0, w: 3, d: 3, h: 1.4, y: p.h + 0.4 });
  });
};

const cooling: Draw = (k, p) => coolingTower(k, { x: p.x, z: p.z, w: p.w, d: p.d, rot: p.rot });

/** A chimney with red-and-white bands. */
const stack: Draw = ({ b, m }, p) => {
  b.cyl(m.concrete, { x: p.x, z: p.z, r: 2.6, h: 1, seg: 16 });
  b.cyl(m.white, { x: p.x, z: p.z, r: 1.9, h: p.h * 0.5, y: 1, top: 1.6, seg: 16 });
  b.cyl(m.stackRed, { x: p.x, z: p.z, r: 1.6, h: p.h * 0.12, y: 1 + p.h * 0.5, top: 1.5, seg: 16 });
  b.cyl(m.white, { x: p.x, z: p.z, r: 1.5, h: p.h * 0.14, y: 1 + p.h * 0.62, top: 1.4, seg: 16 });
  b.cyl(m.stackRed, {
    x: p.x,
    z: p.z,
    r: 1.4,
    h: p.h * 0.12,
    y: 1 + p.h * 0.76,
    top: 1.3,
    seg: 16,
  });
  b.cyl(m.white, { x: p.x, z: p.z, r: 1.3, h: p.h * 0.12, y: 1 + p.h * 0.88, top: 1.2, seg: 16 });
};

const tank: Draw = ({ b, m }, p) => {
  b.cyl(m.concrete, { x: p.x, z: p.z, r: p.w + 1.2, h: 0.4, seg: 28 });
  b.cyl(m.tankShell, { x: p.x, z: p.z, r: p.w, h: p.h, y: 0.4, seg: 28 });
  b.cyl(m.tankTop, { x: p.x, z: p.z, r: p.w + 0.1, h: 0.3, y: 0.4 + p.h, seg: 28 });
  b.box(m.steel, { x: p.x + p.w + 0.1, z: p.z, w: 0.4, d: 0.9, h: p.h });
};

/** Pipes on posts: the way the plant is fed, and one of the things that joins the buildings. */
const rack: Draw = ({ b, m }, p) => {
  b.frame(p.x, p.z, p.rot, () => {
    for (let t = -p.w / 2; t <= p.w / 2 + 0.1; t += 10)
      b.box(m.steel, { x: t, z: 0, w: 0.5, d: 0.5, h: p.h });
    b.box(m.steel, { x: 0, z: 0, w: p.w, d: Math.max(1.2, p.d), h: 0.4, y: p.h });
    b.box(m.supply, { x: 0, z: -0.3, w: p.w, d: 0.35, h: 0.35, y: p.h + 0.4, shadow: false });
    b.box(m.returning, { x: 0, z: 0.3, w: p.w, d: 0.35, h: 0.35, y: p.h + 0.4, shadow: false });
  });
};

/** A running track round a pitch, with a stand along one side. */
const track: Draw = ({ b, m }, p) => {
  b.frame(p.x, p.z, p.rot, () => {
    const r = p.d / 2;
    const run = p.w - p.d;
    const inner = r - 7;
    b.box(m.track, { x: 0, z: 0, w: run, d: p.d, h: 0.1, shadow: false });
    for (const s of [-1, 1])
      b.cyl(m.track, { x: (s * run) / 2, z: 0, r, h: 0.1, seg: 36, shadow: false });
    b.box(m.lawn, { x: 0, z: 0, w: run, d: inner * 2, h: 0.16, shadow: false });
    for (const s of [-1, 1])
      b.cyl(m.lawn, { x: (s * run) / 2, z: 0, r: inner, h: 0.16, seg: 36, shadow: false });
    b.box(m.mark, { x: 0, z: 0, w: 0.25, d: inner * 2, h: 0.04, y: 0.16, shadow: false });
    b.box(m.mark, { x: 0, z: 0, w: run + inner, d: 0.25, h: 0.04, y: 0.16, shadow: false });
    b.box(m.concrete, { x: 0, z: r + 3, w: run * 0.8, d: 4, h: 3 });
    b.box(m.roof, { x: 0, z: r + 3, w: run * 0.84, d: 5, h: 0.3, y: 5 });
  });
};

const court: Draw = ({ b, m }, p) => {
  b.frame(p.x, p.z, p.rot, () => {
    b.box(m.court, { x: 0, z: 0, w: p.w, d: p.d, h: 0.1, shadow: false });
    b.box(m.mark, { x: 0, z: 0, w: p.w - 3, d: 0.15, h: 0.03, y: 0.1, shadow: false });
    b.box(m.mark, { x: 0, z: 0, w: 0.15, d: p.d - 2, h: 0.03, y: 0.1, shadow: false });
    b.box(m.dark, { x: 0, z: 0, w: 0.1, d: p.d, h: 1.0, y: 0.1, shadow: false });
  });
};

/** One lobe of a pond: a stone edge and the water. */
const water: Draw = ({ b, m }, p) => {
  b.cyl(m.stone, { x: p.x, z: p.z, r: p.w + 1.4, h: 0.11, seg: 36, shadow: false });
  b.cyl(m.water, { x: p.x, z: p.z, r: p.w, h: 0.05, y: 0.11, seg: 36, shadow: false });
};

const path: Draw = ({ b, m }, p) =>
  b.box(m.stone, { x: p.x, z: p.z, w: p.w, d: p.d, h: 0.1, rot: p.rot, shadow: false });

const pavilion: Draw = ({ b, m }, p) => {
  b.frame(p.x, p.z, p.rot, () => {
    for (const sx of [-1, 1])
      for (const sz of [-1, 1])
        b.cyl(m.white, { x: sx * 3.4, z: sz * 3.4, r: 0.22, h: 3.2, seg: 8 });
    b.box(m.roof, { x: 0, z: 0, w: 9, d: 9, h: 0.4, y: 3.2, round: 0.15 });
    b.box(m.stone, { x: 0, z: 0, w: 8, d: 8, h: 0.2 });
  });
};

/** An abstract sculpture of stacked blocks, as in the sculpture parks of the campuses. */
const sculpture: Draw = ({ b, m }, p) => {
  const mat = m.solid(SCULPTURES[p.v % SCULPTURES.length] as string, 0.5, 0.3);
  b.cyl(m.stone, { x: p.x, z: p.z, r: 3, h: 0.3, seg: 12 });
  b.box(mat, { x: p.x, z: p.z, w: 1.6, d: 1.6, h: p.h * 0.5, y: 0.3, rot: 0.3 });
  b.box(mat, { x: p.x + 0.4, z: p.z, w: 1.2, d: 1.2, h: p.h * 0.3, y: 0.3 + p.h * 0.5, rot: 0.8 });
  b.cyl(mat, { x: p.x + 0.8, z: p.z, r: 0.6, h: p.h * 0.25, y: 0.3 + p.h * 0.8, seg: 10 });
};

/** A tower crane: mast, jib with a counterweight, cab and a hanging hook. */
const crane: Draw = ({ b, m }, p) => {
  const jib = Math.min(28, p.h * 0.62);
  b.box(m.concrete, { x: p.x, z: p.z, w: 5, d: 5, h: 1 });
  b.frame(p.x, p.z, p.rot, () => {
    b.box(m.generator, { x: 0, z: 0, w: 1.8, d: 1.8, h: p.h, y: 1 });
    b.box(m.generator, { x: (jib - 10) / 2, z: 0, w: jib + 10, d: 1.1, h: 1.3, y: p.h + 1 });
    b.box(m.concrete, { x: -8.5, z: 0, w: 3.4, d: 2.4, h: 2.6, y: p.h - 0.4 });
    b.box(m.dark, { x: 1.4, z: 1.4, w: 2.2, d: 2, h: 2.2, y: p.h - 1.4 });
    b.box(m.generator, { x: 0, z: 0, w: 1.2, d: 1.2, h: 6, y: p.h + 2.3 });
    b.pipe(m.dark, [0, p.h + 8.3, 0], [jib - 1, p.h + 1.8, 0], 0.08, { shadow: false });
    b.pipe(m.dark, [0, p.h + 8.3, 0], [-8, p.h + 1.8, 0], 0.08, { shadow: false });
    b.pipe(m.dark, [jib * 0.7, p.h + 1, 0], [jib * 0.7, p.h * 0.45, 0], 0.05, { shadow: false });
    b.box(m.dark, { x: jib * 0.7, z: 0, w: 1.2, d: 1.2, h: 1.2, y: p.h * 0.45 - 1 });
  });
};

/** A steel frame going up: columns and beams, with the lowest floors already decked. */
const frame: Draw = ({ b, m }, p) => {
  const cols = 5;
  const rows = 4;
  b.frame(p.x, p.z, p.rot, () => {
    b.box(m.concrete, { x: 0, z: 0, w: p.w + 3, d: p.d + 3, h: 0.5, tile: 32 });
    for (let i = 0; i < cols; i++)
      for (let j = 0; j < rows; j++)
        b.box(m.steel, {
          x: (i / (cols - 1) - 0.5) * p.w,
          z: (j / (rows - 1) - 0.5) * p.d,
          w: 0.7,
          d: 0.7,
          h: p.n * p.h + 3,
          y: 0.5,
        });
    for (let level = 1; level <= p.n; level++) {
      const y = 0.5 + level * p.h;
      for (let j = 0; j < rows; j++)
        b.box(m.steel, { x: 0, z: (j / (rows - 1) - 0.5) * p.d, w: p.w, d: 0.5, h: 0.6, y });
      for (let i = 0; i < cols; i++)
        b.box(m.steel, { x: (i / (cols - 1) - 0.5) * p.w, z: 0, w: 0.5, d: p.d, h: 0.6, y });
      if (level < p.n) b.box(m.concrete, { x: 0, z: 0, w: p.w, d: p.d, h: 0.35, y: y + 0.6 });
    }
  });
};

const container: Draw = ({ b, m }, p) =>
  b.box(m.solid(CONTAINERS[p.v % CONTAINERS.length] as string, 0.6, 0.3), {
    x: p.x,
    z: p.z,
    w: p.w,
    d: p.d,
    h: 2.6,
    rot: p.rot,
  });

/** A lorry at a dock: a cab and a long box. */
const truck: Draw = ({ b, m }, p) => {
  b.frame(p.x, p.z, p.rot, () => {
    b.box(m.white, { x: 6.4, z: 0, w: 2.6, d: 2.5, h: 2.7, y: 0.6, round: 0.3 });
    b.box(m.glass, { x: 7.6, z: 0, w: 0.2, d: 2.1, h: 1.1, y: 1.9 });
    b.box(m.galv, { x: -1.4, z: 0, w: 11.6, d: 2.6, h: 3.1, y: 0.8 });
    b.box(m.dark, { x: 0, z: 0, w: 14, d: 2.0, h: 0.6, y: 0.1 });
  });
};

/** The net fence round a building site. */
const fence: Draw = ({ b, m }, p) => {
  const net = m.solid("#e8803a", 0.8, 0);
  for (const [x, z, w, d] of [
    [0, -p.d / 2, p.w, 0.1],
    [0, p.d / 2, p.w, 0.1],
    [-p.w / 2, 0, 0.1, p.d],
    [p.w / 2, 0, 0.1, p.d],
  ] as const)
    b.box(net, { x: p.x + x, z: p.z + z, w, d, h: 2.1, shadow: false });
};

const DRAW: Readonly<Record<world3d.PieceKind, Draw>> = {
  pad,
  slab,
  deck,
  hall,
  cooling,
  stack,
  tank,
  rack,
  track,
  court,
  water,
  path,
  pavilion,
  sculpture,
  crane,
  frame,
  container,
  truck,
  fence,
};

/** The ground of a place the map gives a building that is not built here: a bare slab with a post at each corner. */
function cleared(k: Kit, list: readonly world3d.Bounds[]): void {
  aprons(k, list);
  for (const a of list)
    for (const x of [a.x0 + 1, a.x1 - 1])
      for (const z of [a.z0 + 1, a.z1 - 1])
        k.b.box(k.m.trim, { x, z, w: 0.8, d: 0.8, h: 1.8, y: APRON_H, shadow: false });
}

/** Everything a campus adds to the land, baked into the kit's meshes. */
export function drawCampus(k: Kit, campus: Campus): void {
  aprons(k, campus.aprons);
  cleared(k, campus.cleared);
  streets(k, campus.streets);
  lamps(k, campus.lamps);
  for (const block of campus.blocks) for (const p of block.pieces) DRAW[p.kind](k, p);
  for (const p of campus.structures) DRAW[p.kind](k, p);
}
