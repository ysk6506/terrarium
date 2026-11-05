/**
 * What stands in one block of a campus (REQ-006, REQ-048): an office, a dormitory, a car park, the
 * central utility plant, a sports ground, a pond, a building site. Each layout is drawn in the block's
 * own frame (origin at its centre, about 76 m of room to a side) and is a plain list of pieces; the view
 * decides how a piece looks. Everything is a function of the block's seed, so a site looks the same every
 * time it is opened.
 */
import { unit } from "./plan";

export type BlockUse =
  | "office"
  | "dorm"
  | "deck"
  | "utility"
  | "tanks"
  | "sports"
  | "pond"
  | "park"
  | "construction"
  | "warehouse"
  | "lawn";

export type PieceKind =
  | "pad"
  | "slab"
  | "deck"
  | "hall"
  | "cooling"
  | "stack"
  | "tank"
  | "rack"
  | "track"
  | "court"
  | "water"
  | "path"
  | "pavilion"
  | "sculpture"
  | "crane"
  | "frame"
  | "container"
  | "truck"
  | "fence";

/** Ground a pad is laid with. */
export const GROUNDS = ["concrete", "lawn", "soil"] as const;

/**
 * One thing on the plan. `w` and `d` are its width and depth before turning (for round things `w` is the
 * radius), `h` its height, `n` how many floors, levels, cells or columns it has, and `v` which variant:
 * the ground of a pad, the tone of a slab, the colour of a container.
 */
export interface Piece {
  readonly kind: PieceKind;
  readonly x: number;
  readonly z: number;
  readonly rot: number;
  readonly w: number;
  readonly d: number;
  readonly h: number;
  readonly n: number;
  readonly v: number;
}

/** A tree in a block's frame. */
export interface LocalTree {
  readonly x: number;
  readonly z: number;
  readonly scale: number;
  readonly tint: number;
}

/** A parking lot in a block's frame: two rows of bays along its width. `y` lifts it onto a roof. */
export interface LocalLot {
  readonly x: number;
  readonly z: number;
  readonly rot: number;
  readonly w: number;
  readonly d: number;
  readonly y: number;
  readonly fill: number;
}

export interface Layout {
  readonly pieces: readonly Piece[];
  readonly trees: readonly LocalTree[];
  readonly lots: readonly LocalLot[];
}

/** How far from the block's centre things may stand. */
export const REACH_M = 34;
/** Where the border trees stand: just inside the street. */
export const EDGE_M = 38;
const FULL_M = 84;

export const piece = (
  kind: PieceKind,
  x: number,
  z: number,
  w: number,
  d: number,
  extra: { rot?: number; h?: number; n?: number; v?: number } = {},
): Piece => ({
  kind,
  x,
  z,
  w,
  d,
  rot: extra.rot ?? 0,
  h: extra.h ?? 0,
  n: extra.n ?? 0,
  v: extra.v ?? 0,
});

const pad = (ground: (typeof GROUNDS)[number], w = FULL_M, d = FULL_M, x = 0, z = 0): Piece =>
  piece("pad", x, z, w, d, { v: GROUNDS.indexOf(ground) });

const lot = (
  x: number,
  z: number,
  w: number,
  d: number,
  fill: number,
  extra: { y?: number; rot?: number } = {},
): LocalLot => ({ x, z, w, d, fill, y: extra.y ?? 0, rot: extra.rot ?? 0 });

/** A numbered run of the block's own random numbers. */
function randomOf(seed: number): () => number {
  let k = 0;
  return () => unit(seed, ++k);
}

const whole = (r: () => number, from: number, to: number): number =>
  from + Math.floor(r() * (to - from + 1));

/** Trees along the border of the block, each side with the given chance, so streets read as avenues. */
function border(seed: number, chance: number, pitch = 13): LocalTree[] {
  const out: LocalTree[] = [];
  const r = randomOf(seed + 301);
  for (let side = 0; side < 4; side++)
    for (let t = -EDGE_M + 4; t <= EDGE_M - 4; t += pitch) {
      if (r() > chance) continue;
      const along = t + (r() - 0.5) * 3;
      const [x, z] =
        side === 0
          ? [along, -EDGE_M]
          : side === 1
            ? [along, EDGE_M]
            : side === 2
              ? [-EDGE_M, along]
              : [EDGE_M, along];
      out.push({ x, z, scale: 0.85 + 0.35 * r(), tint: r() });
    }
  return out;
}

/** A few trees inside, each in the given rectangle (centre, half sizes), clear of the middle. */
function grove(
  seed: number,
  n: number,
  cx: number,
  cz: number,
  hw: number,
  hd: number,
): LocalTree[] {
  const r = randomOf(seed + 701);
  return Array.from({ length: n }, () => ({
    x: cx + (r() - 0.5) * 2 * hw,
    z: cz + (r() - 0.5) * 2 * hd,
    scale: 0.8 + 0.6 * r(),
    tint: r(),
  }));
}

function office(seed: number): Layout {
  const r = randomOf(seed);
  const main = whole(r, 5, 10);
  const wing = whole(r, 2, 4);
  return {
    pieces: [
      pad("concrete"),
      piece("slab", 0, -20, 58, 20, { h: main * 3.9, n: main, v: 0 }),
      piece("slab", 14, 2, 30, 16, { h: wing * 3.9, n: wing, v: 0 }),
      piece("path", -14, 10, 3, 34, { v: 0 }),
    ],
    trees: [...border(seed, 0.9), ...grove(seed, 6, -14, 14, 18, 8)],
    lots: [lot(0, 26, 58, 16.8, 0.75)],
  };
}

function dorm(seed: number): Layout {
  const r = randomOf(seed);
  const high = whole(r, 11, 16);
  const low = whole(r, 8, 12);
  return {
    pieces: [
      pad("lawn"),
      piece("slab", 0, -25, 48, 13, { h: high * 3, n: high, v: 1 }),
      piece("slab", -4, -5, 44, 13, { h: low * 3, n: low, v: 1 }),
      piece("slab", 26, 12, 12, 24, { h: 3.6, n: 1, v: 2 }),
      piece("path", -6, 8, 40, 3, { v: 0 }),
    ],
    trees: [...border(seed, 0.9), ...grove(seed, 7, -8, 12, 22, 8)],
    lots: [lot(-6, 27, 50, 16.8, 0.6)],
  };
}

function deck(seed: number): Layout {
  const r = randomOf(seed);
  const levels = whole(r, 4, 6);
  return {
    pieces: [pad("concrete"), piece("deck", 0, -2, 66, 36, { h: levels * 3.2, n: levels })],
    trees: border(seed, 0.55),
    lots: [lot(0, -2, 58, 26.4, 0.7, { y: levels * 3.2 + 0.5 }), lot(0, 26, 50, 16.8, 0.5)],
  };
}

function utility(seed: number): Layout {
  const r = randomOf(seed);
  const stacks = whole(r, 2, 3);
  return {
    pieces: [
      pad("concrete"),
      piece("hall", 0, -22, 50, 24, { h: 15, n: 0, v: 0 }),
      piece("rack", 0, -6, 50, 1.2, { h: 7 }),
      piece("cooling", -2, 12, 36, 9),
      piece("cooling", -2, 26, 36, 9),
      ...Array.from({ length: stacks }, (_, i) =>
        piece("stack", 30 - i * 5.5, 2, 0, 0, { h: 42 + 6 * i }),
      ),
      piece("tank", -30, -2, 4.5, 0, { h: 9 }),
      piece("tank", -30, 7, 4.5, 0, { h: 9 }),
    ],
    trees: border(seed, 0.3),
    lots: [],
  };
}

function tanks(seed: number): Layout {
  const r = randomOf(seed);
  const radius = 5.5 + r() * 2;
  const grid = Array.from({ length: 6 }, (_, i) => ({
    x: -22 + (i % 3) * 22,
    z: -12 + Math.floor(i / 3) * 24,
  }));
  return {
    pieces: [
      pad("concrete"),
      ...grid.map((p, i) => piece("tank", p.x, p.z, radius, 0, { h: 8 + (i % 3) * 2 })),
      piece("rack", 0, 0, 56, 1.2, { h: 4.5 }),
      piece("hall", 0, 31, 24, 8, { h: 5, v: 1 }),
    ],
    trees: border(seed, 0.3),
    lots: [],
  };
}

function sports(seed: number): Layout {
  return {
    pieces: [
      pad("lawn"),
      piece("track", 0, -14, 68, 42),
      piece("court", -14, 24, 24, 12),
      piece("court", 14, 24, 24, 12),
    ],
    trees: [...border(seed, 0.7), ...grove(seed, 4, 0, 33, 30, 3)],
    lots: [],
  };
}

function pond(seed: number): Layout {
  const r = randomOf(seed);
  const flip = r() > 0.5 ? -1 : 1;
  return {
    pieces: [
      pad("lawn"),
      piece("water", 0, 0, 24, 0),
      piece("water", -16 * flip, 11, 15, 0),
      piece("water", 17 * flip, -9, 14, 0),
      piece("path", 0, 31, 60, 3, { v: 0 }),
      piece("pavilion", 28 * flip, -28, 0, 0, { rot: flip > 0 ? 0 : Math.PI / 2 }),
    ],
    trees: [...border(seed, 1), ...grove(seed, 9, 0, -30, 30, 4), ...grove(seed, 5, 0, 30, 28, 3)],
    lots: [],
  };
}

function park(seed: number): Layout {
  const r = randomOf(seed);
  return {
    pieces: [
      pad("lawn"),
      piece("path", 0, 0, 3.2, 76, { rot: Math.PI / 4, v: 0 }),
      piece("path", 0, 0, 3.2, 76, { rot: -Math.PI / 4, v: 0 }),
      piece("pavilion", 0, 0, 0, 0, { rot: r() > 0.5 ? 0 : Math.PI / 2 }),
      ...Array.from({ length: 4 }, (_, i) =>
        piece("sculpture", i < 2 ? -22 : 22, i % 2 === 0 ? -22 : 22, 0, 0, {
          h: 4 + r() * 3,
          v: i,
        }),
      ),
    ],
    trees: [...border(seed, 1), ...grove(seed, 14, 0, 0, 30, 30)],
    lots: [],
  };
}

function construction(seed: number): Layout {
  const r = randomOf(seed);
  const levels = whole(r, 2, 4);
  return {
    pieces: [
      pad("soil"),
      piece("fence", 0, 0, 80, 80),
      piece("frame", 8, -6, 36, 26, { n: levels, h: 4.5, v: 4 }),
      piece("crane", -22, -22, 0, 0, { h: 46, rot: r() * Math.PI }),
      piece("crane", 26, 20, 0, 0, { h: 38, rot: r() * Math.PI }),
      ...Array.from({ length: 6 }, (_, i) =>
        piece("container", -28 + (i % 3) * 7.5, 26 + Math.floor(i / 3) * 3.2, 6, 2.4, {
          v: whole(r, 0, 4),
        }),
      ),
      piece("truck", -4, 30, 0, 0, { rot: Math.PI / 2 }),
    ],
    trees: [],
    lots: [],
  };
}

function warehouse(seed: number): Layout {
  const r = randomOf(seed);
  return {
    pieces: [
      pad("concrete"),
      piece("hall", 0, -20, 64, 28, { h: whole(r, 9, 12), v: 1 }),
      ...Array.from({ length: 4 }, (_, i) => piece("truck", -22 + i * 15, -1, 0, 0, { rot: 0 })),
    ],
    trees: border(seed, 0.3),
    lots: [lot(0, 27, 56, 16.8, 0.5)],
  };
}

function lawn(seed: number): Layout {
  return {
    pieces: [pad("lawn"), piece("path", 0, 0, 3, 70, { rot: unit(seed, 5) * Math.PI, v: 0 })],
    trees: [...border(seed, 1), ...grove(seed, 12, 0, 0, 30, 30)],
    lots: [],
  };
}

const LAYOUTS: Readonly<Record<BlockUse, (seed: number) => Layout>> = {
  office,
  dorm,
  deck,
  utility,
  tanks,
  sports,
  pond,
  park,
  construction,
  warehouse,
  lawn,
};

export const layoutOf = (use: BlockUse, seed: number): Layout => LAYOUTS[use](seed);
