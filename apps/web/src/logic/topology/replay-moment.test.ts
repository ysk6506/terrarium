import { Catalog } from "@terrarium/core/catalog";
import { DEFAULT_SHAPE, generateShaped } from "@terrarium/core/sources/worldgen";
import type { Mark } from "@terrarium/core/topology";
import { BlueprintIndex } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { barsOf, momentAt, relative, serversMoved } from "./replay";

const catalog = new Catalog();
const index = new BlueprintIndex(generateShaped(DEFAULT_SHAPE, catalog).blueprint);

describe("the replay counts its times from the start of the run [REQ-078]", () => {
  test("a bar runs from the fault to its end, and an incident still open runs to the end of the run", () => {
    const bars = barsOf(
      [
        { from: 1100, to: 1400, target: "crah-1" },
        { from: 1200, target: "crah-2" },
        { from: 900, to: 5000, target: "ups-a" },
      ],
      1000,
      600,
    );
    expect(bars).toEqual([
      { from: 100, to: 400, open: false, target: "crah-1" },
      { from: 200, to: 600, open: true, target: "crah-2" },
      { from: 0, to: 600, open: false, target: "ups-a" },
    ]);
  });

  test("marks are moved to run time, and so are the moments they stand for", () => {
    const marks: Mark[] = [{ kind: "fault", t: 1046, at: [1046, 1100] }];
    expect(relative(marks, 1000)).toEqual([{ kind: "fault", t: 46, at: [46, 100] }]);
    expect(relative([], 1000)).toEqual([]);
  });

  test("a run with no events shows the world at rest at any moment, with no fault and no alarm", () => {
    for (const t of [0, 300]) {
      const m = momentAt(index, catalog, [], 0, t);
      expect(m.source.index).toBe(index);
      expect(m.source.faults()).toEqual([]);
      expect(m.source.alarms()).toEqual([]);
    }
  });

  test("with nothing happening, no server is in the impact range before or after", () => {
    const moved = serversMoved(index, catalog, [], undefined);
    expect(moved.before).toBe(0);
    expect(moved.after).toBe(0);
    expect(serversMoved(index, catalog, [], 100).at).toBe(99.999);
  });
});
