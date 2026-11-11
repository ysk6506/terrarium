import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { findRoot } from "../common";
import { JOURNEY_IDS } from "./score";

const source = readFileSync(path.join(findRoot(), "tests/e2e/ux/journeys.ts"), "utf8");

/** The ids of the journey list: each line `["id", function],` between the list's start and its `];`. */
const listed = (): string[] => {
  const from = source.indexOf("export const JOURNEYS");
  const body = source.slice(from, source.indexOf("\n];", from));
  return [...body.matchAll(/^\s+\["([a-z-]+)", \w+\],/gm)].map((m) => m[1] as string);
};

describe("the CI groups of UX journeys lose none and repeat none [REQ-114]", () => {
  const groups: Record<string, string[]> = {};
  const block = source.slice(source.indexOf("export const JOURNEY_GROUPS"));
  for (const m of block.slice(0, block.indexOf("};")).matchAll(/^\s+(\w+): \[([^\]]*)\]/gm))
    groups[m[1] as string] = [...(m[2] as string).matchAll(/"([a-z-]+)"/g)].map(
      (x) => x[1] as string,
    );

  test("there are five groups, named as the workflow names them", () => {
    expect(Object.keys(groups).sort()).toEqual(["build", "flow", "own", "small", "topology"]);
  });

  test("every journey the harness scores is in exactly one group", () => {
    expect(Object.values(groups).flat().sort()).toEqual([...JOURNEY_IDS].sort());
  });

  test("a journey comes after the ones whose work it uses, inside its group", () => {
    const flow = groups.flow ?? [];
    expect(flow.indexOf("design")).toBeLessThan(flow.indexOf("process-compare"));
    expect(flow.indexOf("run")).toBeLessThan(flow.indexOf("share"));
    expect(flow.indexOf("run")).toBeLessThan(flow.indexOf("fork"));
  });

  test("the journeys that run are the journeys that are scored", () => {
    expect(listed().sort()).toEqual([...JOURNEY_IDS].sort());
  });
});
