import { Catalog } from "@terrarium/core/catalog";
import { DEFAULT_CAMPUS, generateCampus } from "@terrarium/core/sources/worldgen";
import { BlueprintIndex } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { isVehicle, lifeOf, MAX_AGENTS, poseAt } from "./life";
import { boundsOfBox, insidePolygon } from "./plan";
import { siteScene } from "./site";

const catalog = new Catalog();
const blueprint = generateCampus(
  {
    ...DEFAULT_CAMPUS,
    site: "giheung",
    seed: 7,
    buildings: 3,
    floors: 2,
    hallsPerFloor: 2,
    podsPerHall: 6,
    detail: 0.3,
  },
  catalog,
).blueprint;
const site = siteScene(new BlueprintIndex(blueprint), catalog);
if (!site) throw new Error("no site");

describe("life on the site [REQ-006] [REQ-036]", () => {
  const agents = lifeOf(site);

  test("a busy campus has every kind of visitor, and never more than the view can bear", () => {
    const kinds = new Set(agents.map((a) => a.kind));
    for (const k of ["person", "cat", "deer", "raccoon", "tanker", "truck"] as const)
      expect(kinds.has(k)).toBe(true);
    expect(kinds.has("sedan") || kinds.has("suv") || kinds.has("van")).toBe(true);
    expect(agents.length).toBeGreaterThan(10);
    expect(agents.length).toBeLessThanOrEqual(MAX_AGENTS);
  });

  test("the same land always has the same visitors, and a quiet setting has none", () => {
    expect(lifeOf(site).map((a) => [a.kind, a.speed, a.offset])).toEqual(
      agents.map((a) => [a.kind, a.speed, a.offset]),
    );
    expect(lifeOf(site, { density: 0 })).toEqual([]);
    expect(lifeOf(site, { density: 0.5 }).length).toBeLessThan(agents.length);
  });

  test("nobody jumps: a step of a fifth of a second moves an agent no further than it can walk", () => {
    for (const a of agents)
      for (let t = 0; t < 300; t += 0.2) {
        const p = poseAt(a, t);
        const q = poseAt(a, t + 0.2);
        expect(Math.hypot(q.x - p.x, q.z - p.z)).toBeLessThanOrEqual(a.speed * 0.2 * 1.8 + 0.05);
      }
  });

  test("vehicles keep to their road, and tankers go where the generators are", () => {
    for (const a of agents.filter((x) => isVehicle(x.kind)))
      for (let t = 0; t < 300; t += 7) {
        const p = poseAt(a, t);
        const near = a.path.some((pt, i) => {
          const n = a.path[i + 1];
          if (!n) return Math.hypot(pt.x - p.x, pt.z - p.z) < 6;
          const len2 = (n.x - pt.x) ** 2 + (n.z - pt.z) ** 2 || 1;
          const k = Math.max(
            0,
            Math.min(1, ((p.x - pt.x) * (n.x - pt.x) + (p.z - pt.z) * (n.z - pt.z)) / len2),
          );
          return Math.hypot(pt.x + (n.x - pt.x) * k - p.x, pt.z + (n.z - pt.z) * k - p.z) < 3;
        });
        expect(near).toBe(true);
      }
    const generators = site.yards.filter((y) => y.kind === "generators").map((y) => y.id);
    const tankerRoutes = agents.filter((a) => a.kind === "tanker");
    expect(tankerRoutes.length).toBeGreaterThan(0);
    for (const a of tankerRoutes) {
      const route = site.roads.routes.find((r) => r.line === a.path);
      expect(generators).toContain(route?.id);
    }
  });

  test("animals stay on the land and out of the buildings", () => {
    const solids = site.buildings.map(boundsOfBox);
    for (const a of agents.filter((x) => x.kind === "deer" || x.kind === "raccoon"))
      for (let t = 0; t < 600; t += 5) {
        const p = poseAt(a, t);
        expect(insidePolygon(p, site.outline)).toBe(true);
        expect(solids.some((b) => p.x > b.x0 && p.x < b.x1 && p.z > b.z0 && p.z < b.z1)).toBe(
          false,
        );
      }
  });

  test("people never spawn or walk onto a car park: no bay, no lane, on any of several lands [REQ-108]", () => {
    const lands = [7, 11, 23].map((seed) => {
      const bp = generateCampus(
        {
          ...DEFAULT_CAMPUS,
          site: "giheung",
          seed,
          buildings: 5,
          floors: 2,
          hallsPerFloor: 2,
          podsPerHall: 6,
          detail: 0.3,
        },
        catalog,
      ).blueprint;
      const land = siteScene(new BlueprintIndex(bp), catalog);
      if (!land) throw new Error("no site");
      return land;
    });
    let walkers = 0;
    for (const land of lands) {
      const lots = land.plan.parking.map((l) => l.area);
      expect(lots.length).toBeGreaterThan(0);
      for (const a of lifeOf(land).filter((x) => x.kind === "person")) {
        walkers++;
        for (let t = 0; t < 400; t += 0.5) {
          const p = poseAt(a, t);
          expect(
            lots.some((l) => p.x > l.x0 && p.x < l.x1 && p.z > l.z0 && p.z < l.z1),
            `a person at ${p.x.toFixed(1)}, ${p.z.toFixed(1)} stands in a car park`,
          ).toBe(false);
        }
      }
    }
    expect(walkers).toBeGreaterThan(0);
  });

  test("an agent rests at both ends of its path and faces the way it walks", () => {
    const a = agents.find((x) => x.kind === "person");
    if (!a) throw new Error("no person");
    const period = 2 * (a.length / a.speed + a.dwell);
    const rests = Array.from({ length: Math.ceil(period) }, (_, i) => poseAt(a, i)).filter(
      (p) => !p.moving,
    );
    expect(rests.length).toBeGreaterThan(0);
    const out = poseAt(a, -a.offset + 0.5);
    const first = a.path[0] as { x: number; z: number };
    const second = a.path[1] as { x: number; z: number };
    expect(Math.sin(out.rot)).toBeCloseTo(
      Math.sign(second.x - first.x) * Math.abs(Math.sin(out.rot)),
      1,
    );
  });
});
