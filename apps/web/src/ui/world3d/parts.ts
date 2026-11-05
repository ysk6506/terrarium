/**
 * The outdoor equipment of a data-centre campus, built from boxes and cylinders in the warm matte look
 * of design C: dry coolers, cooling towers, chillers, generators, transformers, switchgear and pylons.
 * Each part is sized to the footprint the world gives it and takes its colours from the model's look.
 */
import type { ModelLook } from "@terrarium/core/catalog";
import type { Baker } from "./baker";
import type { Materials } from "./materials";

export interface Kit {
  readonly b: Baker;
  readonly m: Materials;
}

/** A thing's centre on the plan, its own width and depth, and its turn. `y` lifts it (a roof). */
export interface Where {
  readonly x: number;
  readonly z: number;
  readonly w: number;
  readonly d: number;
  readonly rot: number;
  readonly y?: number;
}

const ONE_FAN_M = 2.6;
const CELL_M = 9;

/** A row of air-cooled fan units on legs. */
export function dryCooler(k: Kit, at: Where): void {
  const { b, m } = k;
  const y = at.y ?? 0;
  const n = Math.max(1, Math.floor(at.w / ONE_FAN_M));
  const pitch = at.w / n;
  const depth = Math.min(at.d, 3.6);
  b.frame(at.x, at.z, at.rot, () => {
    for (let i = 0; i < n; i++) {
      const x = (i - (n - 1) / 2) * pitch;
      b.box(m.steel, { x, z: 0, w: pitch * 0.8, d: depth * 0.86, h: 0.7, y });
      b.box(m.galv, { x, z: 0, w: pitch * 0.94, d: depth, h: 1.5, y: y + 0.7, round: 0.18 });
      b.cyl(m.dark, { x, z: 0, r: Math.min(pitch, depth) * 0.4, h: 0.12, y: y + 2.2, seg: 20 });
      b.cyl(m.white, { x, z: 0, r: 0.2, h: 0.3, y: y + 2.3, seg: 8 });
    }
  });
}

/** Cells of an induced-draught cooling tower on a basin, each with a fan stack and a plume. */
export function coolingTower(k: Kit, at: Where): void {
  const { b, m } = k;
  const y0 = at.y ?? 0;
  const n = Math.max(1, Math.round(at.w / CELL_M));
  const cell = at.w / n;
  const side = Math.min(cell, at.d) * 0.92;
  b.frame(at.x, at.z, at.rot, () => {
    b.box(m.concrete, { x: 0, z: 0, w: at.w + 1.5, d: at.d + 1.5, h: 0.5, y: y0, tile: 32 });
    for (let i = 0; i < n; i++) {
      const x = (i - (n - 1) / 2) * cell;
      b.box(m.tower, { x, z: 0, w: side, d: side, h: 7, y: y0 + 0.5, round: 0.35 });
      b.box(m.steel, { x, z: 0, w: side + 0.05, d: side + 0.05, h: 1.4, y: y0 + 1.2 });
      b.cyl(m.white, { x, z: 0, r: side * 0.43, h: 1.8, y: y0 + 7.5, top: side * 0.38, seg: 28 });
      b.cyl(m.dark, { x, z: 0, r: side * 0.34, h: 0.2, y: y0 + 9.2, seg: 28 });
      b.pipe(m.dark, [x - side * 0.3, 9.3, 0], [x + side * 0.3, 9.3, 0], 0.1, { shadow: false });
      for (let j = 0; j < 4; j++)
        b.cyl(m.plume, {
          x: x + Math.sin(j * 2 + i) * 0.7,
          z: Math.cos(j * 1.7) * 0.7,
          r: 2.1 + j * 0.8,
          h: 2.2,
          y: y0 + 10.2 + j * 2.1,
          seg: 12,
          shadow: false,
        });
    }
  });
}

/** A packaged chiller: a long skid with compressors, a condenser deck and fans. */
export function chiller(k: Kit, at: Where, look: ModelLook): void {
  const { b, m } = k;
  const y = at.y ?? 0;
  const paint = m.paintOf(look);
  const accent = m.solid(look.accent, 0.6, 0.1);
  b.frame(at.x, at.z, at.rot, () => {
    b.box(m.concrete, { x: 0, z: 0, w: at.w + 1, d: at.d + 1, h: 0.3, y, tile: 32 });
    b.box(paint, { x: 0, z: 0, w: at.w, d: at.d, h: 3, y: y + 0.3, round: 0.3 });
    b.box(accent, {
      x: 0,
      z: at.d / 2 + 0.01,
      w: at.w * 0.96,
      d: 0.04,
      h: 0.35,
      y: y + 1.4,
      shadow: false,
    });
    const fans = Math.max(2, Math.floor(at.w / 3.4));
    for (let i = 0; i < fans; i++) {
      const x = (i - (fans - 1) / 2) * (at.w / fans);
      b.cyl(m.dark, {
        x,
        z: 0,
        r: Math.min(at.w / fans, at.d) * 0.4,
        h: 0.12,
        y: y + 3.3,
        seg: 20,
      });
    }
    for (const dx of [-0.34, 0.34])
      b.lying(m.galv, {
        x: at.w * dx,
        y: y + 1.3,
        z: -at.d / 2 - 0.35,
        r: 0.32,
        length: at.w * 0.2,
      });
  });
}

/** A containerised generator set with its radiator, exhaust stack and day tank. */
export function generator(k: Kit, at: Where, look: ModelLook): void {
  const { b, m } = k;
  const y0 = at.y ?? 0;
  const paint = m.paintOf(look);
  const stripe = m.solid(look.accent, 0.6, 0.1);
  const len = at.w;
  b.frame(at.x, at.z, at.rot, () => {
    b.box(m.concrete, { x: 0, z: 0, w: len + 1.2, d: at.d + 1.2, h: 0.3, y: y0, tile: 32 });
    b.box(paint, { x: 0, z: 0, w: len * 0.86, d: at.d * 0.82, h: 3.1, y: y0 + 0.35, round: 0.3 });
    b.box(stripe, { x: 0, z: 0, w: len * 0.865, d: at.d * 0.825, h: 0.3, y: y0 + 1.2, round: 0 });
    for (let i = -2; i <= 2; i++)
      b.box(m.dark, {
        x: i * len * 0.12,
        z: at.d * 0.41 + 0.02,
        w: 0.06,
        d: 0.06,
        h: 1.5,
        y: y0 + 1.5,
        shadow: false,
      });
    b.box(m.galv, {
      x: -len * 0.45,
      z: 0,
      w: len * 0.1,
      d: at.d * 0.7,
      h: 2.6,
      y: y0 + 0.5,
      round: 0.1,
    });
    b.cyl(m.dark, { x: len * 0.3, z: -at.d * 0.2, r: 0.26, h: 3.4, y: y0 + 3.4, seg: 12 });
  });
}

/** An oil transformer: tank, cooling fins, bushings and a conservator. */
export function transformer(k: Kit, at: Where, look: ModelLook): void {
  const { b, m } = k;
  const y0 = at.y ?? 0;
  const paint = m.paintOf(look);
  const tw = at.w * 0.6;
  const td = at.d * 0.55;
  b.frame(at.x, at.z, at.rot, () => {
    b.box(m.concrete, { x: 0, z: 0, w: at.w, d: at.d, h: 0.4, y: y0, tile: 32 });
    b.box(paint, { x: 0, z: 0, w: tw, d: td, h: 4.2, y: y0 + 0.6, round: 0.3 });
    for (const sx of [-1, 1])
      for (let i = 0; i < 7; i++)
        b.box(paint, {
          x: sx * (tw / 2 + 0.2),
          z: (i - 3) * (td / 7),
          w: 0.14,
          d: td / 9,
          h: 3.6,
          y: y0 + 0.8,
        });
    for (let i = -1; i <= 1; i++) {
      b.cyl(m.white, { x: i * (tw / 3), z: 0, r: 0.2, h: 1.4, y: y0 + 4.8, top: 0.32, seg: 10 });
      b.cyl(m.dark, { x: i * (tw / 3), z: 0, r: 0.3, h: 0.14, y: y0 + 6.2, seg: 10 });
    }
    b.lying(m.galv, { x: 0, y: y0 + 5.6, z: -td * 0.3, r: 0.55, length: tw * 0.9 });
  });
}

/** Switchgear, an automatic transfer switch or a panel: a row of cabinets with doors and an indicator strip. */
export function cabinets(k: Kit, at: Where, look: ModelLook): void {
  const { b, m } = k;
  const y0 = at.y ?? 0;
  const paint = m.paintOf(look);
  const n = Math.max(1, Math.round(at.w / 1.1));
  const pitch = at.w / n;
  b.frame(at.x, at.z, at.rot, () => {
    b.box(m.concrete, { x: 0, z: 0, w: at.w + 0.8, d: at.d + 0.8, h: 0.2, y: y0, tile: 32 });
    b.box(paint, { x: 0, z: 0, w: at.w, d: at.d, h: 2.4, y: y0 + 0.2, round: 0.08 });
    for (let i = 1; i < n; i++)
      b.box(m.dark, {
        x: (i - n / 2) * pitch,
        z: at.d / 2 + 0.01,
        w: 0.04,
        d: 0.04,
        h: 2.2,
        y: y0 + 0.3,
        shadow: false,
      });
    b.box(m.solid(look.accent, 0.5, 0.1), {
      x: 0,
      z: at.d / 2 + 0.02,
      w: at.w * 0.9,
      d: 0.04,
      h: 0.18,
      y: y0 + 1.9,
      shadow: false,
    });
  });
}

/** A busway run: trunking on posts, in the power colour. */
export function busway(k: Kit, at: Where): void {
  const { b, m } = k;
  b.frame(at.x, at.z, at.rot, () => {
    b.box(m.power, {
      x: 0,
      z: 0,
      w: at.w,
      d: Math.max(0.5, Math.min(at.d, 0.9)),
      h: 0.5,
      y: 3.6,
      round: 0.1,
    });
    for (let i = 0; i <= Math.floor(at.w / 6); i++)
      b.box(m.steel, { x: -at.w / 2 + i * 6, z: 0, w: 0.2, d: 0.2, h: 3.6 });
  });
}

/** What a yard item of this style looks like. */
export function yardItemPart(k: Kit, style: string, at: Where, look: ModelLook): void {
  if (style === "dry_cooler") dryCooler(k, at);
  else if (style === "cooling_tower") coolingTower(k, at);
  else if (style === "chiller") chiller(k, at, look);
  else if (style === "generator") generator(k, at, look);
  else if (style === "transformer") transformer(k, at, look);
  else if (style === "busway") busway(k, at);
  else cabinets(k, at, look);
}

/** A lattice pylon of the grid. */
export function pylon(k: Kit, x: number, z: number, h: number): void {
  const { b, m } = k;
  const leg = 1.5;
  const corners: ReadonlyArray<readonly [number, number]> = [
    [-leg, -leg],
    [leg, -leg],
    [-leg, leg],
    [leg, leg],
  ];
  for (const [dx, dz] of corners)
    b.pipe(m.galv, [x + dx, 0, z + dz], [x + dx * 0.3, h, z + dz * 0.3], 0.14);
  for (let y = 4; y < h - 2; y += 5) {
    const s = 1 - y / h;
    b.pipe(m.galv, [x - leg * s, y, z], [x + leg * s * 0.8, y + 4.5, z], 0.07, { shadow: false });
    b.pipe(m.galv, [x + leg * s, y, z], [x - leg * s * 0.8, y + 4.5, z], 0.07, { shadow: false });
  }
  for (const [arm, height] of [
    [9, h - 3],
    [7, h - 8],
  ] as const)
    b.pipe(m.galv, [x - arm, height, z], [x + arm, height, z], 0.2);
}
