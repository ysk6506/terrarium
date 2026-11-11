/**
 * [REQ-087] A host starts below its memory limit, in every world the product builds (ADR-0172, ADR-0178). A server that
 * carried many service processes began at 100 % in the hand-made campus, so its services were slow before anything
 * had gone wrong and no solution could bring the portal back. The rule is about the world, not about that server: the
 * healthy state of a host never reaches the lowest memory limit of the services or the alarm that reads it (90 %).
 */
import { Catalog } from "@terrarium/core/catalog";
import {
  DEFAULT_CAMPUS,
  DEFAULT_WORLDGEN,
  generateCampus,
  generateWorld,
} from "@terrarium/core/sources/worldgen";
import { type Blueprint, hostOsOf, serviceDef, World } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { GOLDEN_WORLDS } from "./test-support/golden-matrix";
import { DEFAULT_WORLD } from "./test-support/offered-means";

const catalog = new Catalog();
const ALARM_PCT = 90;

/** The hosts that start at or above their limit, as `id memory%`. */
function crowded(blueprint: Blueprint): string[] {
  const world = World.fromBlueprint(blueprint, catalog);
  const limit = Math.min(
    ALARM_PCT,
    ...world.index.ofKind("service").map((s) => serviceDef(s).conditions.maxMemPct),
  );
  return [...world.index.ofKind("server"), ...world.index.ofKind("vm")]
    .map((e) => ({ id: e.id, mem: hostOsOf(world, e.id).memPct }))
    .filter((h) => h.mem >= limit)
    .map((h) => `${h.id} ${h.mem}%`);
}

describe("a host starts below its memory limit in every world the product builds [REQ-087]", () => {
  for (const world of GOLDEN_WORLDS)
    test(`${world.id}: no server or VM starts at its memory limit`, () => {
      expect(crowded(world.make())).toEqual([]);
    });

  test("the default shaped world", () => {
    expect(crowded(DEFAULT_WORLD.make())).toEqual([]);
  });

  test("a generated world and a generated campus", () => {
    expect(crowded(generateWorld({ ...DEFAULT_WORLDGEN, seed: 1, site: "giheung" }, catalog).blueprint)).toEqual([]);
    expect(
      crowded(generateCampus({ ...DEFAULT_CAMPUS, seed: 1, site: "giheung" }, catalog).blueprint),
    ).toEqual([]);
  });

  test("a host with ten service processes still ends under the limit, and one with a few keeps its old share", () => {
    const campus = GOLDEN_WORLDS.find((w) => w.id === "campus")?.make() as Blueprint;
    const world = World.fromBlueprint(campus, catalog);
    const crowdedHost = hostOsOf(world, "srv-t1");
    expect(crowdedHost.processes.filter((p) => p.user === "svc").length).toBeGreaterThanOrEqual(10);
    expect(crowdedHost.memPct).toBeLessThan(ALARM_PCT);
    const few = hostOsOf(world, "srv-l1").processes.filter((p) => p.user === "svc");
    expect(few.every((p) => p.memPct === 9)).toBe(true);
  });
});
