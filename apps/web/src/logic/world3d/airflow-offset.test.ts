import { describe, expect, test } from "vitest";
import { fieldAt, fieldOf } from "./airflow-field";
import type { RackSpot, UnitSpot } from "./airflow-model";
import type { RoomScene } from "./room";

/** The same room twice: once with its floor starting at the room's corner, once with a piece lying left of and above the body. */
const sceneAt = (dx: number, dz: number): RoomScene =>
  ({
    w: 16,
    d: 10,
    pods: [{ aisle: "cold", enclosure: { x0: dx + 6, z0: dz + 3, x1: dx + 10, z1: dz + 6 } }],
    bounds: { x0: dx, z0: dz, x1: dx + 16, z1: dz + 10 },
    rects: [{ x0: dx, z0: dz, x1: dx + 16, z1: dz + 10 }],
  }) as unknown as RoomScene;

const rackAt = (x: number, z: number, inletC: number): RackSpot =>
  ({
    id: `r${x}`,
    x,
    z,
    fx: 0,
    fz: 1,
    w: 0.6,
    d: 1.2,
    h: 2,
    form: "air",
    inletC,
    outletC: inletC + 12,
  }) as unknown as RackSpot;

const unitAt = (x: number, z: number): UnitSpot =>
  ({
    id: "u",
    name: "u",
    x,
    z,
    fx: 0,
    fz: 1,
    w: 1,
    d: 1,
    h: 2,
    baseY: 0,
    drive: 1,
    running: true,
    supplyC: 18,
    returnC: 30,
    loadKw: 10,
    capacityKw: 40,
  }) as unknown as UnitSpot;

describe("moving a room does not change its temperature picture [REQ-072]", () => {
  test("a room whose floor starts away from the corner gives the same values as one that starts at it", () => {
    const here = fieldOf(
      sceneAt(0, 0),
      [rackAt(7, 4, 22), rackAt(9, 4, 26)],
      [unitAt(2, 5)],
      24,
      "inlet",
    );
    const moved = fieldOf(
      sceneAt(5, 3),
      [rackAt(12, 7, 22), rackAt(14, 7, 26)],
      [unitAt(7, 8)],
      24,
      "inlet",
    );
    expect(moved.cols).toBe(here.cols);
    expect(moved.rows).toBe(here.rows);
    expect(moved.x0).toBe(5);
    expect(moved.z0).toBe(3);
    for (let i = 0; i < here.values.length; i++)
      expect(moved.values[i] as number).toBeCloseTo(here.values[i] as number, 3);
  });

  test("a point of the moved room is read from the moved grid", () => {
    const moved = fieldOf(sceneAt(5, 3), [rackAt(12, 7, 22)], [unitAt(7, 8)], 24, "outlet");
    const cold = fieldAt(moved, 8, 8);
    const far = fieldAt(moved, 20, 12);
    expect(Number.isFinite(cold)).toBe(true);
    expect(cold).not.toBe(far);
  });
});
