import { describe, expect, test } from "vitest";
import { planRoads } from "./roads";

const yard = [
  { x: 0, z: 0 },
  { x: 200, z: 0 },
  { x: 200, z: 100 },
  { x: 0, z: 100 },
];

describe("roads between the gate and the doors of a site [REQ-048]", () => {
  test("a door that reaches the gate gets a road, and the road is reported as reached", () => {
    const plan = planRoads({
      outline: yard,
      obstacles: [],
      gate: { x: 10, z: 50 },
      targets: [{ id: "a", door: { x: 180, z: 50 } }],
    });
    expect(plan.reached.has("a")).toBe(true);
    expect(plan.routes.map((r) => r.id)).toEqual(["a"]);
    expect(plan.rects.length).toBeGreaterThan(0);
  });

  test("a door cut off from the gate by a wall of buildings gets no road, and the others still do", () => {
    const wall = { x0: 90, z0: -10, x1: 110, z1: 110 };
    const plan = planRoads({
      outline: yard,
      obstacles: [wall],
      gate: { x: 10, z: 50 },
      targets: [
        { id: "near", door: { x: 60, z: 50 } },
        { id: "behind", door: { x: 180, z: 50 } },
      ],
    });
    expect(plan.reached.has("near")).toBe(true);
    expect(plan.reached.has("behind")).toBe(false);
  });

  test("a gate far from any open ground gives no roads at all", () => {
    const plan = planRoads({
      outline: [
        { x: 0, z: 0 },
        { x: 30, z: 0 },
        { x: 30, z: 30 },
        { x: 0, z: 30 },
      ],
      obstacles: [],
      gate: { x: 900, z: 900 },
      targets: [{ id: "a", door: { x: 10, z: 10 } }],
    });
    expect(plan.rects).toEqual([]);
    expect(plan.routes).toEqual([]);
    expect(plan.reached.size).toBe(0);
  });
});
