import { Catalog } from "@terrarium/core/catalog";
import { InvalidValueError } from "@terrarium/core/kernel";
import { parseOutline, rectInOutline } from "@terrarium/core/spatial";
import { blueprintDigest, World } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { type CampusSpec, DEFAULT_CAMPUS, generateCampus, SITE_PRESETS } from ".";

const catalog = new Catalog();

const small = (over: Partial<CampusSpec> = {}): CampusSpec => ({
  ...DEFAULT_CAMPUS,
  site: "giheung",
  seed: 7,
  buildings: 1,
  hallsPerFloor: 2,
  podsPerHall: 2,
  ...over,
});

const errors = (spec: CampusSpec) =>
  generateCampus(spec, catalog).issues.filter((i) => i.severity === "error");

describe("generateCampus builds a valid campus [REQ-047]", () => {
  test("the same spec gives the same world, and another seed another one", () => {
    const a = generateCampus(small(), catalog).blueprint;
    expect(blueprintDigest(generateCampus(small(), catalog).blueprint)).toBe(blueprintDigest(a));
    expect(blueprintDigest(generateCampus(small({ seed: 8 }), catalog).blueprint)).not.toBe(
      blueprintDigest(a),
    );
  });

  test.each(SITE_PRESETS.map((p) => [p.id]))("%s: the campus has no errors", (site) => {
    expect(errors(small({ site: site as CampusSpec["site"], buildings: 2 }))).toEqual([]);
  });

  test("limits are enforced with a reason in Korean", () => {
    expect(() => generateCampus(small({ buildings: 0 }), catalog)).toThrow(InvalidValueError);
    expect(() =>
      generateCampus(
        small({ buildings: 6, floors: 4, hallsPerFloor: 4, podsPerHall: 80 }),
        catalog,
      ),
    ).toThrow(/랙이 .*개다/);
  });
});

describe("halls differ in size, cooling and containment [REQ-047] [REQ-043]", () => {
  const big = generateCampus(
    {
      ...DEFAULT_CAMPUS,
      site: "pyeongtaek",
      seed: 3,
      buildings: 4,
      hallsPerFloor: 3,
      podsPerHall: 6,
    },
    catalog,
  );

  test("a mixed campus has air, hybrid, direct-liquid and immersion halls of different sizes", () => {
    expect(new Set(big.halls.map((h) => h.mode))).toEqual(
      new Set(["air", "hybrid", "dlc", "immersion"]),
    );
    expect(new Set(big.halls.map((h) => h.pods)).size).toBeGreaterThan(3);
    expect(Math.max(...big.halls.map((h) => h.racks))).toBeGreaterThan(
      2 * Math.min(...big.halls.map((h) => h.racks)),
    );
  });

  test("an air-only profile makes only air halls; an AI profile ends in immersion", () => {
    const air = generateCampus(small({ profile: "air", buildings: 2 }), catalog);
    expect(new Set(air.halls.map((h) => h.mode))).toEqual(new Set(["air"]));
    const ai = generateCampus(small({ profile: "ai-liquid", buildings: 2 }), catalog);
    expect(ai.halls.map((h) => h.mode)).toContain("dlc");
    expect(ai.halls.map((h) => h.mode)).toContain("immersion");
  });

  test("containment differs hall to hall, and a hall without it has no containment entities", () => {
    expect(new Set(big.halls.map((h) => h.containment)).size).toBeGreaterThanOrEqual(3);
    const index = World.fromBlueprint(big.blueprint, catalog).index;
    for (const hall of big.halls) {
      const pods = index.childrenOf(hall.id, "containment");
      if (hall.containment === "none") expect(pods).toEqual([]);
      else expect(pods.length).toBeGreaterThan(0);
      if (hall.containment === "hot") expect(pods.every((p) => p.props.aisle === "hot")).toBe(true);
      if (hall.containment === "cold")
        expect(pods.every((p) => p.props.aisle === "cold")).toBe(true);
    }
  });

  test("a hall holds as many containments as the spec asks for, tens of them", () => {
    const wide = generateCampus(
      small({ profile: "air", hallsPerFloor: 1, podsPerHall: 30, fill: 0.2 }),
      catalog,
    );
    const [hall] = wide.halls;
    expect(hall?.pods).toBeGreaterThanOrEqual(15);
    expect(hall?.pods).toBeLessThanOrEqual(60);
  });

  test("equipment comes from many makers, and a single-maker hall keeps to one", () => {
    const makers = (r: typeof big) => {
      const out = new Set<string>();
      for (const e of r.blueprint.entities)
        if (e.modelId && catalog.has(e.modelId)) out.add(catalog.get(e.modelId).vendor ?? "");
      return out;
    };
    expect(makers(big).size).toBeGreaterThanOrEqual(10);
    const single = generateCampus(small({ vendors: "single", profile: "air" }), catalog);
    const serverMakers = new Set(
      single.blueprint.entities
        .filter((e) => e.kind === "server")
        .map((e) => catalog.get(e.modelId ?? "").vendor),
    );
    expect(serverMakers.size).toBeLessThanOrEqual(2);
  });
});

describe("the building is fed by a real chain [REQ-046] [REQ-044]", () => {
  const { blueprint } = generateCampus(small({ profile: "ai-liquid", hallsPerFloor: 2 }), catalog);
  const world = World.fromBlueprint(blueprint, catalog);

  test("every server reaches a transformer, a generator and a UPS through its PDU", () => {
    const reach = (from: string): Set<string> => {
      const seen = new Set<string>();
      const walk = (id: string) => {
        for (const l of world.index.outgoing(id, "power"))
          if (!seen.has(l.to)) {
            seen.add(l.to);
            walk(l.to);
          }
      };
      walk(from);
      return seen;
    };
    for (const server of world.index.ofKind("server")) {
      const kinds = new Set([...reach(server.id)].map((id) => world.index.entity(id).kind));
      expect(kinds).toEqual(new Set(["pdu", "power_panel", "ups", "generator"]));
    }
  });

  test("each side has transformers and generators with a spare, standing in the yard", () => {
    for (const side of ["a", "b"]) {
      const gens = world.index.ofKind("generator").filter((g) => g.props.side === side);
      const transformers = world.index
        .ofKind("power_panel")
        .filter((p) => p.modelId === "sy-transformer-2500kva" && p.props.side === side);
      expect(gens.length).toBeGreaterThanOrEqual(2);
      expect(transformers.length).toBeGreaterThanOrEqual(1);
      for (const e of [...gens, ...transformers]) expect(e.parentId).toBe("gh");
    }
  });

  test("a hall with liquid racks has CDUs, and every plant has a transfer switch of its own", () => {
    expect(world.index.ofKind("cdu").length).toBeGreaterThanOrEqual(2);
    for (const plant of world.index.ofKind("chiller")) {
      const feeds = world.index.outgoing(plant.id, "power").map((l) => l.to);
      expect(feeds.length).toBeGreaterThan(0);
      expect(world.index.entity(feeds[0] as string).modelId).toBe("sy-ats-1600a");
    }
  });
});

describe("the campus stands on the real shape of its site [REQ-048]", () => {
  const campus = generateCampus(small({ buildings: 3, site: "hwaseong" }), catalog);
  const site = campus.blueprint.entities.find((e) => e.kind === "site");
  const outline = parseOutline(site?.props.outline);

  test("the site keeps its outline and every building stands inside it", () => {
    expect(outline?.length).toBeGreaterThanOrEqual(6);
    const buildings = campus.blueprint.entities.filter((e) => e.kind === "building");
    expect(buildings).toHaveLength(3);
    for (const b of buildings) {
      const p = b.placement;
      if (p?.type !== "area" || !outline) throw new Error("building without area");
      expect(rectInOutline({ x: p.x, y: p.y, w: p.w, d: p.d }, outline)).toBe(true);
    }
  });

  test("land next to the shape is for sale in parcels, and the site records where it lies on the map", () => {
    const parcels = campus.blueprint.entities.filter((e) => e.kind === "parcel");
    expect(parcels.length).toBeGreaterThan(0);
    expect(parcels.every((p) => p.props.owned === false && Number(p.props.priceM) > 0)).toBe(true);
    expect(Number(site?.props.mapX)).toBeGreaterThan(0);
    expect(Number(site?.props.mapY)).toBeGreaterThan(0);
  });
});
