import { Catalog } from "@terrarium/core/catalog";
import { CLEARED_PLOT_KINDS, parseReserved } from "@terrarium/core/spatial";
import { buildingPurposeOf, World } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { type CampusSpec, DEFAULT_CAMPUS, generateCampus, SITE_CAMPUS_MIX, sitePreset } from ".";

const catalog = new Catalog();

const hwaseong = (over: Partial<CampusSpec> = {}) =>
  generateCampus(
    { ...DEFAULT_CAMPUS, ...SITE_CAMPUS_MIX.hwaseong, site: "hwaseong", seed: 3, ...over },
    catalog,
  );

const rectOf = (e: { placement?: { type: string } } | undefined) => {
  const p = e?.placement as { type: string; x: number; y: number; w: number; d: number };
  return { x: p.x, y: p.y, w: p.w, d: p.d };
};
const apart = (
  a: { x: number; y: number; w: number; d: number },
  b: { x: number; y: number; w: number; d: number },
) => a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.d <= b.y || b.y + b.d <= a.y;

describe("every place the map shows for a building stays spoken for [REQ-056] [REQ-048]", () => {
  test("a site built in full has no ground left over, one built in part keeps the places it left", () => {
    const full = hwaseong().blueprint.entities.find((e) => e.kind === "site");
    const bare = (plots: ReturnType<typeof parseReserved>) =>
      plots.filter((p) => CLEARED_PLOT_KINDS.includes(p.kind));
    expect(bare(parseReserved(full?.props.reserved))).toEqual([]);

    const part = hwaseong({ fabs: 3, labs: 1 });
    const site = part.blueprint.entities.find((e) => e.kind === "site");
    const left = parseReserved(site?.props.reserved);
    expect(left.filter((p) => p.kind === "fab")).toHaveLength(4);
    expect(left.filter((p) => p.kind === "lab")).toHaveLength(2);
    expect(left.filter((p) => p.kind === "dc")).toHaveLength(0);
    const preset = sitePreset("hwaseong");
    const slot = preset?.fabs[3];
    expect(slot).toBeTruthy();
    if (!slot) return;
    expect(left).toContainEqual({
      kind: "fab",
      x: Math.round(slot.x - slot.w / 2),
      y: Math.round(slot.y - slot.d / 2),
      w: slot.w,
      d: slot.d,
    });
  });

  test("buildings with no place of their own are put clear of the places left, and so is the plant", () => {
    const result = generateCampus(
      { ...DEFAULT_CAMPUS, site: "pyeongtaek", seed: 3, buildings: 3, fabs: 2, podsPerHall: 4 },
      catalog,
    );
    const entities = result.blueprint.entities;
    const site = entities.find((e) => e.kind === "site");
    const left = parseReserved(site?.props.reserved);
    expect(left.filter((p) => p.kind === "fab")).toHaveLength(4);
    expect(left.filter((p) => CLEARED_PLOT_KINDS.includes(p.kind))).toHaveLength(5);
    expect(left.length).toBeGreaterThan(20);
    for (const b of entities.filter((e) => e.kind === "building"))
      for (const plot of left)
        expect(apart(rectOf(b), plot), `${b.id} on a ${plot.kind}`).toBe(true);
    for (const e of entities.filter(
      (x) => x.placement?.type === "spot" && x.parentId === site?.id,
    )) {
      const p = e.placement as { x: number; y: number };
      for (const plot of left)
        expect(
          p.x > plot.x && p.x < plot.x + plot.w && p.y > plot.y && p.y < plot.y + plot.d,
          `${e.id} on a ${plot.kind}`,
        ).toBe(false);
    }
  });
});

describe("the server rooms of Hwaseong: the HPC centre, the fabs and the DSR towers [REQ-056] [REQ-043]", () => {
  const result = hwaseong();
  const world = World.fromBlueprint(result.blueprint, catalog);
  const named = (name: string) => world.index.ofKind("building").find((b) => b.name === name);
  const floorsOf = (id: string) =>
    world.index
      .childrenOf(id, "floor")
      .map((f) => (f.placement?.type === "level" ? f.placement.level : 0));
  const roomsOf = (building: string) => result.halls.filter((h) => h.building === building);

  test("the HPC centre is one data-centre building of eleven floors with many halls, bigger than any room in a fab", () => {
    const hpc = named("HPC센터");
    expect(hpc && buildingPurposeOf(hpc)).toBe("data_center");
    expect(
      world.index.ofKind("building").filter((b) => buildingPurposeOf(b) === "data_center"),
    ).toHaveLength(1);
    expect(Math.max(...floorsOf(hpc?.id ?? ""))).toBe(11);
    const halls = roomsOf("hs-dc1");
    expect(halls.length).toBeGreaterThanOrEqual(20);
    const fabRooms = result.halls.filter((h) => h.building.includes("-fab"));
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(mean(halls.map((h) => h.racks))).toBeGreaterThan(
      1.3 * mean(fabRooms.map((h) => h.racks)),
    );
    expect(Math.max(...halls.map((h) => h.racks))).toBeGreaterThan(
      Math.max(...fabRooms.map((h) => h.racks)),
    );
  });

  test("a fab keeps one or two small server rooms on one floor, a few dozen containments each", () => {
    const fabs = world.index.ofKind("building").filter((b) => buildingPurposeOf(b) === "fab");
    expect(fabs).toHaveLength(7);
    const floorsUsed = new Set<string>();
    for (const fab of fabs) {
      const rooms = roomsOf(fab.id);
      expect(rooms.length).toBe(2);
      expect(new Set(rooms.map((r) => r.name.slice(0, 2))).size).toBe(1);
      floorsUsed.add(rooms[0]?.name.slice(0, 2) ?? "");
      for (const r of rooms) {
        expect(r.pods).toBeGreaterThanOrEqual(10);
        expect(r.pods).toBeLessThanOrEqual(30);
        expect(r.racks / r.pods).toBeGreaterThanOrEqual(8);
        expect(r.racks / r.pods).toBeLessThanOrEqual(20);
      }
    }
    expect(floorsUsed.size).toBeGreaterThan(1);
  });

  test("the DSR towers A, B and C are tall research buildings with rooms on their own floors: C two on 3F, B one on 5F", () => {
    const towers = ["A", "B", "C"].map((l) => named(`DSR동 ${l}타워`));
    for (const t of towers) {
      expect(t && buildingPurposeOf(t)).toBe("research");
      expect(Math.max(...floorsOf(t?.id ?? ""))).toBe(27);
    }
    const names = (i: number) => roomsOf(`hs-lab${i}`).map((r) => r.name);
    expect(names(3)).toEqual(["3F-A 서버룸", "3F-B 서버룸"]);
    expect(names(2)).toEqual(["5F-A 서버룸"]);
    expect(names(1)).toHaveLength(1);
  });

  test("the whole site builds without errors and every plant yard stands on its land", () => {
    expect(result.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(result.notes).toEqual([]);
  });

  test("the plant of the HPC centre finds room on the land whichever seed the campus is built from", () => {
    for (const seed of [7, 9]) expect(hwaseong({ seed }).notes, `seed ${seed}`).toEqual([]);
  });
});
