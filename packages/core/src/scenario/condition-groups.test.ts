import { describe, expect, test } from "vitest";
import { allOf } from "./library";
import type { Condition } from "./model";

const state = (n: number): Condition => ({
  kind: "state",
  entity: `e-${n}`,
  field: "powered",
  op: "==",
  value: true,
});

const widest = (c: Condition): number =>
  c.kind === "all" || c.kind === "any" ? Math.max(c.of.length, ...c.of.map(widest)) : 0;

const leaves = (c: Condition): Condition[] =>
  c.kind === "all" || c.kind === "any" ? c.of.flatMap(leaves) : [c];

describe("a long list of conditions fits the 20-per-group limit [REQ-033]", () => {
  test("up to 20 stay in one group", () => {
    const list = Array.from({ length: 20 }, (_, i) => state(i));
    expect(allOf(list)).toEqual({ kind: "all", of: list });
  });

  test("more become groups of groups, in order, with nothing lost", () => {
    for (const n of [21, 40, 401, 1500]) {
      const list = Array.from({ length: n }, (_, i) => state(i));
      const grouped = allOf(list);
      expect(widest(grouped)).toBeLessThanOrEqual(20);
      expect(leaves(grouped)).toEqual(list);
    }
  });
});
