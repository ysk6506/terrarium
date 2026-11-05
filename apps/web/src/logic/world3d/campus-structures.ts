/**
 * The buildings of a campus that the map shows and the world does not model (REQ-057): offices, the
 * utility plant, water works, substations, a logistics centre, a building site. Each stands on the plot
 * the map gives it, so the pieces are laid out in the plot's own frame (its long side along `u`, the
 * other along `v`) and then turned into the plan. Only the plot decides the look, so a site is the same
 * every time it is opened.
 */
import { type Piece, piece } from "./campus-layouts";
import type { Bounds } from "./plan";

/** The kinds of plot that are drawn as a building (the rest of the kinds stay bare ground). */
export type StructureKind =
  | "office"
  | "utility"
  | "tanks"
  | "substation"
  | "warehouse"
  | "construction";

export interface Plot extends Bounds {
  readonly kind?: string;
}

/** A plot in its own frame: where it stands, how long and wide it is, and whether it is turned a quarter. */
interface Frame {
  readonly cx: number;
  readonly cz: number;
  readonly len: number;
  readonly wid: number;
  readonly turn: boolean;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** The pieces of one plot, built in the plot's frame. */
class Layer {
  readonly pieces: Piece[] = [];
  constructor(private readonly f: Frame) {}

  add(
    kind: Piece["kind"],
    u: number,
    v: number,
    w: number,
    d: number,
    extra: { h?: number; n?: number; v?: number; rot?: number } = {},
  ): void {
    const { cx, cz, turn } = this.f;
    const at = turn ? { x: cx + v, z: cz - u } : { x: cx + u, z: cz + v };
    this.pieces.push(
      piece(kind, at.x, at.z, w, d, { ...extra, rot: (extra.rot ?? 0) + (turn ? Math.PI / 2 : 0) }),
    );
  }

  /** The ground the whole plot is paved or grassed with. */
  ground(kind: 0 | 1 | 2): void {
    this.add("pad", 0, 0, this.f.len, this.f.wid, { v: kind });
  }
}

function office(l: Layer, { len, wid }: Frame, seed: number): void {
  l.ground(0);
  const main = clamp(Math.round(len / 9) + (seed % 3), 4, 12);
  l.add("slab", 0, -wid * 0.1, clamp(len - 12, 18, 110), clamp(wid * 0.45, 12, 30), {
    h: main * 3.9,
    n: main,
    v: 0,
  });
  if (wid >= 40) l.add("pad", 0, wid * 0.33, len - 10, wid * 0.22, { v: 1 });
}

function utility(l: Layer, { len, wid }: Frame, seed: number): void {
  l.ground(0);
  const segments = clamp(Math.ceil(len / 90), 1, 8);
  const each = len / segments;
  for (let i = 0; i < segments; i++)
    l.add("hall", (i - (segments - 1) / 2) * each, -wid * 0.2, each - 3, wid * 0.46, {
      h: 12 + ((seed + i) % 3) * 2,
      v: 0,
    });
  l.add("rack", 0, wid * 0.1, len - 12, 1.2, { h: 7 });
  const towers = clamp(Math.floor(len / 60), 1, 5);
  for (let i = 0; i < towers; i++)
    l.add(
      "cooling",
      (i - (towers - 1) / 2) * (len / towers),
      wid * 0.32,
      clamp(len / towers - 8, 10, 30),
      8,
    );
  if (len * wid > 15_000) {
    l.add("stack", -len * 0.4, wid * 0.05, 0, 0, { h: 42 });
    l.add("stack", len * 0.4, wid * 0.05, 0, 0, { h: 48 });
  }
}

function tanks(l: Layer, { len, wid }: Frame, seed: number): void {
  l.ground(0);
  const r = clamp(Math.min(len, wid) / 6, 4, 9);
  const pitch = 2 * r + 5;
  const cols = clamp(Math.floor((len - 10) / pitch), 1, 8);
  const rows = clamp(Math.floor((wid - 10) / pitch), 1, 3);
  for (let i = 0; i < cols; i++)
    for (let j = 0; j < rows; j++)
      l.add("tank", (i - (cols - 1) / 2) * pitch, (j - (rows - 1) / 2) * pitch, r, 0, {
        h: 7 + ((i + j + seed) % 3) * 2,
      });
  l.add("hall", len / 2 - 14, wid / 2 - 7, 20, 9, { h: 5, v: 1 });
}

function substation(l: Layer, { len, wid }: Frame): void {
  l.ground(0);
  for (const side of [-1, 1]) l.add("rack", 0, side * wid * 0.3, len - 10, 1.2, { h: 9 });
  const count = clamp(Math.floor((len - 14) / 14), 2, 40);
  for (let i = 0; i < count; i++)
    l.add("container", (i - (count - 1) / 2) * 14, 0, 7, 4.5, { v: 4 });
  l.add("hall", len / 2 - 12, -wid / 2 + 8, 16, 9, { h: 5, v: 1 });
}

function warehouse(l: Layer, { len, wid }: Frame): void {
  l.ground(0);
  l.add("hall", 0, -wid * 0.2, len - 14, wid * 0.52, { h: 11, v: 1 });
  const trucks = clamp(Math.floor((len - 20) / 24), 2, 8);
  for (let i = 0; i < trucks; i++) l.add("truck", (i - (trucks - 1) / 2) * 24, wid * 0.22, 0, 0);
}

function construction(l: Layer, { len, wid }: Frame, seed: number): void {
  l.ground(2);
  l.add("fence", 0, 0, len - 4, wid - 4);
  l.add("frame", len * 0.08, -wid * 0.06, clamp(len * 0.5, 14, 60), clamp(wid * 0.4, 10, 30), {
    n: 2 + (seed % 3),
    h: 4.5,
    v: 4,
  });
  l.add("crane", -len * 0.32, -wid * 0.28, 0, 0, { h: 46, rot: (seed % 7) * 0.4 });
  for (let i = 0; i < 4; i++) l.add("container", -len * 0.3 + i * 8, wid * 0.32, 6, 2.4, { v: i });
}

const BUILD: Readonly<Record<StructureKind, (layer: Layer, frame: Frame, seed: number) => void>> = {
  office,
  utility,
  tanks,
  substation,
  warehouse,
  construction,
};

export function isStructure(kind: string | undefined): kind is StructureKind {
  return kind !== undefined && kind in BUILD;
}

/** The pieces that stand on the plots the map gives to buildings of the campus; plots of other kinds give none. */
export function structuresOf(plots: readonly Plot[]): Piece[] {
  return plots.flatMap((p) => {
    if (!isStructure(p.kind)) return [];
    const w = p.x1 - p.x0;
    const d = p.z1 - p.z0;
    const frame: Frame = {
      cx: (p.x0 + p.x1) / 2,
      cz: (p.z0 + p.z1) / 2,
      len: Math.max(w, d),
      wid: Math.min(w, d),
      turn: d > w,
    };
    const layer = new Layer(frame);
    BUILD[p.kind](layer, frame, Math.abs(Math.round(p.x0 * 7 + p.z0 * 13)));
    return layer.pieces;
  });
}
