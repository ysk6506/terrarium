import { Catalog } from "@terrarium/core/catalog";
import { CLEARED_PLOT_KINDS, PLOT_KINDS, parseReserved } from "@terrarium/core/spatial";
import { describe, expect, test } from "vitest";
import {
  DEFAULT_CAMPUS,
  generateCampus,
  SITE_CAMPUS_MIX,
  type SiteId,
  type SiteSlot,
  sitePreset,
} from ".";

const catalog = new Catalog();

const campus = (site: SiteId, over: Record<string, unknown> = {}) =>
  generateCampus(
    { ...DEFAULT_CAMPUS, ...SITE_CAMPUS_MIX[site], site, seed: 3, podsPerHall: 4, ...over },
    catalog,
  );

const namesOf = (site: SiteId, over: Record<string, unknown> = {}) =>
  campus(site, over)
    .blueprint.entities.filter((e) => e.kind === "building")
    .map((e) => e.name);

const slot = (site: SiteId, name: string): SiteSlot & { kind?: string } => {
  const preset = sitePreset(site);
  const all: Array<SiteSlot & { kind?: string }> = [
    ...(preset?.fabs ?? []),
    ...(preset?.dcs ?? []),
    ...(preset?.places ?? []),
  ];
  const found = all.find((s) => s.name === name);
  if (!found) throw new Error(`${site} has no place called ${name}`);
  return found;
};

describe("buildings carry the names the maps give them [REQ-057] [REQ-056]", () => {
  test("Hwaseong builds the lines the pictures show, the HPC centre and the three DSR towers", () => {
    expect(namesOf("hwaseong").sort()).toEqual(
      [
        "17라인",
        "V1",
        "S3",
        "15라인",
        "16라인",
        "12·13라인",
        "S4",
        "HPC센터",
        "DSR동 A타워",
        "DSR동 B타워",
        "DSR동 C타워",
      ].sort(),
    );
  });

  test("Pyeongtaek builds P1 to P4 and keeps P5 and P6 as bare sites; Giheung builds its three lines and no data centre", () => {
    expect(namesOf("pyeongtaek").sort()).toEqual(["P1 FAB", "P2 FAB", "P3 FAB", "P4 FAB"]);
    const left = parseReserved(
      campus("pyeongtaek").blueprint.entities.find((e) => e.kind === "site")?.props.reserved,
    );
    const p5 = slot("pyeongtaek", "P5 FAB");
    expect(left).toContainEqual({
      kind: "fab",
      x: Math.round(p5.x - p5.w / 2),
      y: Math.round(p5.y - p5.d / 2),
      w: p5.w,
      d: p5.d,
    });
    expect(left.filter((p) => p.kind === "fab")).toHaveLength(2);
    expect(namesOf("giheung").sort()).toEqual(["6라인", "NRD-K", "S1라인"]);
  });

  test("a campus asked for more fabs than the map names still builds them, the extra ones unnamed", () => {
    const names = namesOf("giheung", { fabs: 4 });
    expect(names).toHaveLength(4);
    expect(names.filter((n) => /^FAB\d+동$/.test(n))).toHaveLength(1);
  });
});

describe("the other buildings of the campus stand where the maps show them [REQ-057] [REQ-056]", () => {
  test("every place is a known kind, has a name, and is reserved in every campus built on the site", () => {
    for (const id of ["giheung", "hwaseong", "pyeongtaek"] as const) {
      const places = sitePreset(id)?.places ?? [];
      for (const p of places) {
        expect(PLOT_KINDS, `${id} ${p.name}`).toContain(p.kind);
        expect(p.name.length).toBeGreaterThan(0);
      }
      const site = campus(id).blueprint.entities.find((e) => e.kind === "site");
      const reserved = parseReserved(site?.props.reserved);
      const structures = reserved.filter((p) => !CLEARED_PLOT_KINDS.includes(p.kind));
      expect(structures.length, id).toBe(
        places.filter((p) => !CLEARED_PLOT_KINDS.includes(p.kind)).length,
      );
    }
    expect(sitePreset("hwaseong")?.places.length).toBeGreaterThanOrEqual(5);
    expect(sitePreset("pyeongtaek")?.places.length).toBeGreaterThanOrEqual(25);
  });

  test("Hwaseong: V1 in front of 17, 16 in front of 15, the HPC centre on the lawn south of V1, DSR in the north-east corner", () => {
    const [l17, v1, l15, l16, hpc] = [
      slot("hwaseong", "17라인"),
      slot("hwaseong", "V1"),
      slot("hwaseong", "15라인"),
      slot("hwaseong", "16라인"),
      slot("hwaseong", "HPC센터"),
    ];
    expect(v1.y).toBeGreaterThan(l17.y);
    expect(l16.y).toBeGreaterThan(l15.y);
    expect(l16.x).toBeLessThan(v1.x);
    expect(hpc.y - hpc.d / 2).toBeGreaterThan(v1.y + v1.d / 2);
    const labs = sitePreset("hwaseong")?.labs ?? [];
    expect(labs).toHaveLength(3);
    for (const t of labs) expect(t.y).toBeLessThan(400);
    expect(Math.min(...labs.map((t) => t.x))).toBeGreaterThan(slot("hwaseong", "12·13라인").x);
  });

  test("Hwaseong: the two offices stand between 15 and 17 on the walk, the substation beside the HPC lawn", () => {
    const a = slot("hwaseong", "사무동 A");
    const b = slot("hwaseong", "사무동 B");
    const l15 = slot("hwaseong", "15라인");
    const l17 = slot("hwaseong", "17라인");
    for (const o of [a, b]) {
      expect(o.x).toBeGreaterThan(l15.x);
      expect(o.x).toBeLessThan(l17.x);
    }
    const sub = slot("hwaseong", "변전소");
    const hpc = slot("hwaseong", "HPC센터");
    expect(sub.x).toBeGreaterThan(hpc.x);
    expect(Math.abs(sub.y - hpc.y)).toBeLessThan(250);
  });

  test("Pyeongtaek: P1 to P4 from north to south in one column, P6 and P5 in the west one, complex buildings between the rows", () => {
    const p = (n: number) => slot("pyeongtaek", `P${n} FAB`);
    expect(p(1).y).toBeLessThan(p(2).y);
    expect(p(2).y).toBeLessThan(p(3).y);
    expect(p(3).y).toBeLessThan(p(4).y);
    expect(p(6).y).toBeLessThan(p(5).y);
    expect(p(5).x).toBeLessThan(p(3).x);
    expect(Math.abs(p(6).y - p(3).y)).toBeLessThan(60);
    expect(Math.abs(p(5).y - p(4).y)).toBeLessThan(60);
    const c34 = slot("pyeongtaek", "3·4기 복합동");
    expect(c34.y).toBeGreaterThan(p(3).y);
    expect(c34.y).toBeLessThan(p(4).y);
    const c56 = slot("pyeongtaek", "5·6기 복합동");
    expect(c56.y).toBeGreaterThan(p(6).y);
    expect(c56.y).toBeLessThan(p(5).y);
    const grid = slot("pyeongtaek", "고덕변전소");
    expect(grid.kind).toBe("substation");
    expect(grid.y).toBeGreaterThan(p(4).y + p(4).d / 2);
  });
});
