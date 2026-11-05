import { describe, expect, test } from "vitest";
import { workBounds } from "./airflow";

describe("the camera goes in on the work of the room [REQ-072]", () => {
  const spot = (x: number, z: number) => ({ x, z, w: 0.6, d: 1.2 });
  const room = { w: 20, d: 10 };

  test("the work box holds the racks and units with a margin, and stays inside the walls", () => {
    const box = workBounds(room, { racks: [spot(5, 5)], units: [] } as never, 2);
    expect(box?.x0).toBeCloseTo(2.4);
    expect(box?.x1).toBeCloseTo(7.6);
    const edge = workBounds(room, { racks: [spot(0.5, 9.8)], units: [spot(19, 5)] } as never, 2);
    expect(edge?.x0).toBe(0);
    expect(edge?.z1).toBe(10);
    expect(edge?.x1).toBe(20);
  });

  test("a room with no racks and no units has no work box", () => {
    expect(workBounds(room, { racks: [], units: [] }, 2)).toBeUndefined();
  });
});
