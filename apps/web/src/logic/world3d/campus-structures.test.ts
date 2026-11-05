import { describe, expect, test } from "vitest";
import { planCampus } from "./campus";
import { isStructure, type Plot, structuresOf } from "./campus-structures";
import { type Bounds, overlapBounds, type Pt } from "./plan";

const square = (side: number): Pt[] => [
  { x: 0, z: 0 },
  { x: side, z: 0 },
  { x: side, z: side },
  { x: 0, z: side },
];

const plot = (kind: string, x0: number, z0: number, w: number, d: number): Plot => ({
  kind,
  x0,
  z0,
  x1: x0 + w,
  z1: z0 + d,
});

const KINDS = ["office", "utility", "tanks", "substation", "warehouse", "construction"] as const;

describe("the buildings the map shows but the world does not model are drawn on their plots [REQ-057] [REQ-056]", () => {
  test("every kind of campus building gives pieces, and none of them leaves its plot", () => {
    for (const kind of KINDS) {
      for (const [w, d] of [
        [150, 60],
        [60, 150],
        [640, 110],
        [45, 100],
      ] as const) {
        const p = plot(kind, 500, 800, w, d);
        const pieces = structuresOf([p]);
        expect(pieces.length, `${kind} ${w}x${d}`).toBeGreaterThan(1);
        for (const q of pieces) {
          const swap = Math.abs(Math.sin(q.rot)) > 0.7 && q.kind !== "container";
          const hw = (swap ? q.d : q.w) / 2;
          const hd = (swap ? q.w : q.d) / 2;
          const inside =
            q.x - hw >= p.x0 - 2 &&
            q.x + hw <= p.x1 + 2 &&
            q.z - hd >= p.z0 - 2 &&
            q.z + hd <= p.z1 + 2;
          expect(inside, `${kind} ${w}x${d} ${q.kind} at ${q.x},${q.z}`).toBe(true);
        }
      }
    }
  });

  test("a long strip is built from several halls, a bare plot and a plot with no kind give nothing", () => {
    const halls = structuresOf([plot("utility", 0, 0, 640, 110)]).filter((p) => p.kind === "hall");
    expect(halls.length).toBeGreaterThanOrEqual(6);
    expect(structuresOf([plot("fab", 0, 0, 200, 100)])).toEqual([]);
    expect(structuresOf([plot("lot", 0, 0, 200, 100)])).toEqual([]);
    expect(structuresOf([{ x0: 0, z0: 0, x1: 100, z1: 100 }])).toEqual([]);
    expect(isStructure("office")).toBe(true);
    expect(isStructure("fab")).toBe(false);
    expect(isStructure(undefined)).toBe(false);
  });

  test("the same plot always gives the same pieces", () => {
    const p = plot("construction", 123, 456, 120, 200);
    expect(structuresOf([p])).toEqual(structuresOf([p]));
  });

  test("the campus draws them, clears only the bare plots, and lays no block over either", () => {
    const fab: Bounds = { x0: 560, z0: 560, x1: 760, z1: 700 };
    const office = plot("office", 900, 560, 80, 140);
    const lot = plot("lot", 1100, 560, 120, 140);
    const campus = planCampus({
      outline: square(1600),
      buildings: [fab],
      yards: [],
      roads: [],
      avoid: [],
      reserved: [office, lot],
      cluster: fab,
      landM2: 1600 * 1600,
      seed: 3,
    });
    expect(campus.structures.length).toBeGreaterThan(1);
    expect(campus.cleared).toEqual([lot]);
    for (const b of campus.blocks)
      for (const p of [office, lot]) expect(overlapBounds(b.cell, p)).toBe(false);
  });
});
