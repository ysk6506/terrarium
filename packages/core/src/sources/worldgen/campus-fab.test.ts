import { Catalog } from "@terrarium/core/catalog";
import { InvalidValueError } from "@terrarium/core/kernel";
import { buildingPurposeOf, roomPurposeOf, World } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { type CampusSpec, DEFAULT_CAMPUS, generateCampus, SITE_CAMPUS_MIX, SITE_PRESETS } from ".";

const catalog = new Catalog();

const campus = (over: Partial<CampusSpec> = {}): CampusSpec => ({
  ...DEFAULT_CAMPUS,
  site: "hwaseong",
  seed: 5,
  buildings: 1,
  fabs: 2,
  hallsPerFab: 3,
  hallsPerFloor: 2,
  podsPerHall: 6,
  ...over,
});

describe("a fab is a building with cleanrooms and a few small server rooms [REQ-043]", () => {
  const result = generateCampus(campus(), catalog);
  const world = World.fromBlueprint(result.blueprint, catalog);
  const fabs = world.index.ofKind("building").filter((b) => buildingPurposeOf(b) === "fab");
  const dcs = world.index.ofKind("building").filter((b) => buildingPurposeOf(b) === "data_center");

  test("the campus has the fabs and the data centres it was asked for, and no errors", () => {
    expect(fabs).toHaveLength(2);
    expect(dcs).toHaveLength(1);
    expect(result.issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  test("every fab floor above the ground has a cleanroom as big as the bay, with nothing in it", () => {
    for (const fab of fabs) {
      const floors = world.index.childrenOf(fab.id, "floor");
      const upper = floors.filter((f) => f.placement?.type === "level" && f.placement.level > 1);
      expect(upper.length).toBeGreaterThanOrEqual(2);
      for (const floor of upper) {
        const bays = world.index
          .childrenOf(floor.id, "room")
          .filter((r) => roomPurposeOf(r) === "cleanroom");
        expect(bays).toHaveLength(1);
        const area = bays[0]?.placement;
        expect(area?.type === "area" && area.w >= 90 && area.d >= 50).toBe(true);
        expect(world.index.childrenOf(bays[0]?.id ?? "")).toHaveLength(0);
      }
    }
  });

  test("a fab's server rooms are smaller than the halls of a data centre, and are called server rooms", () => {
    const inFab = result.halls.filter((h) => h.building.includes("-fab"));
    const inDc = result.halls.filter((h) => h.building.includes("-dc"));
    expect(inFab).toHaveLength(6);
    expect(inFab.every((h) => h.name.endsWith("서버룸"))).toBe(true);
    expect(Math.max(...inFab.map((h) => h.pods))).toBeLessThan(
      Math.max(...inDc.map((h) => h.pods)),
    );
  });

  test("a fab is far bigger on the ground than a data centre", () => {
    const area = (id: string) => {
      const p = world.index.entity(id).placement;
      return p?.type === "area" ? p.w * p.d : 0;
    };
    const smallest = Math.min(...fabs.map((f) => area(f.id)));
    expect(smallest).toBeGreaterThan(3 * Math.max(...dcs.map((d) => area(d.id))));
  });
});

describe("campuses of fabs only, and the mix of each real site [REQ-043] [REQ-048]", () => {
  test("a campus may have no data-centre building: the control room is then in the first fab", () => {
    const result = generateCampus(campus({ buildings: 0, fabs: 1 }), catalog);
    const world = World.fromBlueprint(result.blueprint, catalog);
    const noc = world.index.ofKind("room").filter((r) => roomPurposeOf(r) === "noc");
    expect(noc).toHaveLength(1);
    expect(noc[0]?.id.startsWith("hs-fab1")).toBe(true);
  });

  test("a campus with nothing in it is refused, with the reason", () => {
    expect(() => generateCampus(campus({ buildings: 0, fabs: 0 }), catalog)).toThrow(
      InvalidValueError,
    );
    expect(() => generateCampus(campus({ buildings: 0, fabs: 0 }), catalog)).toThrow(
      /건물이 하나도/,
    );
  });

  test("the same spec gives the same world", () => {
    const a = generateCampus(campus(), catalog).blueprint;
    const b = generateCampus(campus(), catalog).blueprint;
    expect(b.entities.length).toBe(a.entities.length);
    expect(b.entities.map((e) => e.id)).toEqual(a.entities.map((e) => e.id));
  });

  test("every site has a mix, and the line sites are mostly fabs", () => {
    for (const p of SITE_PRESETS) {
      const mix = SITE_CAMPUS_MIX[p.id];
      expect(mix.buildings + mix.fabs).toBeGreaterThanOrEqual(1);
    }
    for (const line of ["giheung", "hwaseong", "pyeongtaek"] as const)
      expect(SITE_CAMPUS_MIX[line].fabs).toBeGreaterThan(SITE_CAMPUS_MIX[line].buildings);
    expect(SITE_CAMPUS_MIX.hwaseong.buildings).toBe(1);
    expect(SITE_CAMPUS_MIX.hwaseong.labs).toBe(3);
    expect(SITE_CAMPUS_MIX.suwon.fabs).toBe(0);
  });

  test.each(SITE_PRESETS.map((p) => [p.id]))("%s: its own mix builds without errors", (site) => {
    const id = site as CampusSpec["site"];
    const mix = SITE_CAMPUS_MIX[id];
    const result = generateCampus(
      campus({ site: id, ...mix, hallsPerFab: 2, podsPerHall: 3 }),
      catalog,
    );
    expect(result.issues.filter((i) => i.severity === "error")).toEqual([]);
  });
});
