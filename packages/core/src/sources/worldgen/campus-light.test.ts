import { Catalog } from "@terrarium/core/catalog";
import { InvalidValueError } from "@terrarium/core/kernel";
import { blueprintDigest, bulkOf, type Entity } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { type CampusSpec, DEFAULT_CAMPUS, generateCampus, MAX_DETAILED_RACKS } from ".";
import { isLightPod } from "./campus-plan";

const catalog = new Catalog();

const spec = (over: Partial<CampusSpec> = {}): CampusSpec => ({
  ...DEFAULT_CAMPUS,
  site: "pyeongtaek",
  seed: 5,
  buildings: 2,
  hallsPerFloor: 2,
  podsPerHall: 20,
  detail: 0.1,
  ...over,
});

const racksOf = (bp: { entities: readonly Entity[] }) =>
  bp.entities.filter((e) => e.kind === "rack");

describe("light racks in generated halls [REQ-049] [REQ-047]", () => {
  test("which pods are built in detail: always the first, then evenly spread", () => {
    expect(isLightPod(0, 0)).toBe(false);
    expect(Array.from({ length: 6 }, (_, i) => isLightPod(i, 1))).toEqual(Array(6).fill(false));
    // The first pod is always built in detail; after it, every other one.
    const half = Array.from({ length: 8 }, (_, i) => isLightPod(i, 0.5));
    expect(half).toEqual([false, false, true, false, true, false, true, false]);
    // About a tenth of a hundred pods, plus the guaranteed first one.
    const built = Array.from({ length: 100 }, (_, i) => isLightPod(i, 0.1)).filter((l) => !l);
    expect(built.length).toBeGreaterThanOrEqual(10);
    expect(built.length).toBeLessThanOrEqual(11);
    expect(Array.from({ length: 5 }, (_, i) => isLightPod(i, 0)).filter((l) => !l)).toHaveLength(1);
  });

  test("most racks of a big hall are light, the world has no errors and holds far fewer entities", () => {
    const light = generateCampus(spec(), catalog);
    const full = generateCampus(spec({ detail: 1 }), catalog);
    expect(light.issues.filter((i) => i.severity === "error")).toEqual([]);
    const racks = racksOf(light.blueprint);
    const lights = racks.filter((r) => bulkOf(r));
    expect(lights.length / racks.length).toBeGreaterThan(0.8);
    // The same halls, but a fraction of the entities building every rack out would take.
    expect(racks.length).toBe(full.stats.rack);
    expect(light.blueprint.entities.length).toBeLessThan(0.4 * full.blueprint.entities.length);
  });

  test("every hall keeps a containment built in detail, with servers to act on", () => {
    const result = generateCampus(spec({ detail: 0 }), catalog);
    const servers = result.blueprint.entities.filter((e) => e.kind === "server");
    for (const hall of result.halls) {
      const racks = result.blueprint.entities.filter(
        (e) => e.kind === "rack" && e.id.startsWith(`${hall.id}-`),
      );
      const detailed = racks.filter((r) => !bulkOf(r));
      expect(detailed.length).toBeGreaterThan(0);
      expect(servers.some((s) => s.id.startsWith(`${hall.id}-`))).toBe(true);
    }
  });

  test("a light rack is fed from both sides and has no devices of its own", () => {
    const { blueprint } = generateCampus(spec({ buildings: 1, hallsPerFloor: 1 }), catalog);
    const light = racksOf(blueprint).filter((r) => bulkOf(r));
    expect(light.length).toBeGreaterThan(0);
    for (const rack of light.slice(0, 20)) {
      const feeds = blueprint.links.filter((l) => l.kind === "power" && l.from === rack.id);
      expect(feeds.map((l) => l.to.at(-1)).sort()).toEqual(["a", "b"]);
      expect(blueprint.entities.some((e) => e.parentId === rack.id)).toBe(false);
    }
  });

  test("light racks are as varied as built ones: several server and rack models", () => {
    const { blueprint } = generateCampus(spec({ profile: "mixed" }), catalog);
    const lights = racksOf(blueprint).filter((r) => bulkOf(r));
    expect(new Set(lights.map((r) => bulkOf(r)?.modelId)).size).toBeGreaterThan(3);
    expect(new Set(lights.map((r) => r.modelId)).size).toBeGreaterThan(3);
  });

  test("the same spec gives the same world, and detail 1 is what it was before", () => {
    const a = generateCampus(spec(), catalog).blueprint;
    expect(blueprintDigest(generateCampus(spec(), catalog).blueprint)).toBe(blueprintDigest(a));
    const full = generateCampus(spec({ detail: 1, podsPerHall: 3 }), catalog).blueprint;
    expect(racksOf(full).some((r) => bulkOf(r))).toBe(false);
  });

  test("limits name the number to lower: all racks, and racks built in detail", () => {
    expect(() => generateCampus(spec({ detail: 1, podsPerHall: 100 }), catalog)).toThrow(
      new RegExp(`서버까지 만드는 랙이 .*${MAX_DETAILED_RACKS}개`),
    );
    expect(() =>
      generateCampus(
        spec({ buildings: 6, floors: 4, hallsPerFloor: 4, podsPerHall: 240, detail: 0 }),
        catalog,
      ),
    ).toThrow(InvalidValueError);
    expect(() => generateCampus(spec({ detail: 1.5 }), catalog)).toThrow(/상세 모델링 비율/);
  });
});
