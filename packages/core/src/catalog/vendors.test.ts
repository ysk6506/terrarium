import { describe, expect, test } from "vitest";
import { BUILTIN_MODELS, Catalog, GENERIC_VENDOR, type ModelKind, manufacturerOf } from ".";

const catalog = new Catalog();
const HEX = /^#[0-9a-f]{6}$/i;

describe("many vendors, each with its own look [REQ-045]", () => {
  test("every model names its vendor and series and says how it looks", () => {
    for (const model of BUILTIN_MODELS) {
      expect([model.id, model.vendor.length > 0, model.series.length > 0]).toEqual([
        model.id,
        true,
        true,
      ]);
      expect(model.look.body).toMatch(HEX);
      expect(model.look.accent).toMatch(HEX);
      expect(["matte", "metal", "glossy"]).toContain(model.look.finish);
    }
  });

  test("each kind of equipment comes from several makers, so a world can mix them", () => {
    const wanted: Partial<Record<ModelKind, number>> = {
      server: 6,
      switch: 3,
      storage: 3,
      rack: 4,
      pdu: 2,
      power_panel: 2,
      ups: 1,
      cooling_unit: 1,
      cdu: 2,
      chiller: 1,
      generator: 1,
    };
    for (const [kind, count] of Object.entries(wanted))
      expect([kind, catalog.vendors(kind as ModelKind).length >= count]).toEqual([kind, true]);
    expect(catalog.vendors().length).toBeGreaterThanOrEqual(20);
  });

  test("vendors are listed A to Z and the lists only hold vendors of that kind", () => {
    const all = catalog.vendors();
    expect(all).toEqual([...all].sort((a, b) => a.localeCompare(b)));
    expect(catalog.vendors("generator")).toEqual(["Torque Gensets"]);
    expect(catalog.vendors("generator").every((v) => all.includes(v))).toBe(true);
  });

  test("the first models keep their ids, so worlds built earlier still load; protocols call them Terrarium Systems", () => {
    for (const id of [
      "srv-2u-compute",
      "crah-100kw",
      "ups-500kva",
      "panel-400a",
      "pdu-17kw",
      "sw-tor-48x25g",
    ]) {
      const model = catalog.get(id);
      expect([id, model.vendor]).toEqual([id, GENERIC_VENDOR]);
      expect(manufacturerOf(model)).toBe("Terrarium Systems");
    }
    expect(manufacturerOf(catalog.get("ax-4u-8gpu-dlc"))).toBe("Aerion AI");
  });

  test("every way of cooling a rack has racks and servers built for it", () => {
    const racks = catalog.list("rack").flatMap((m) => (m.kind === "rack" ? [m] : []));
    for (const method of ["air", "rdhx", "dlc", "immersion"] as const)
      expect([method, racks.some((r) => r.cooling === method)]).toEqual([method, true]);
    expect(
      racks
        .filter((r) => r.form === "tank")
        .every((r) => r.cooling === "immersion" && r.fluidLitres > 0),
    ).toBe(true);
    const servers = catalog.list("server").flatMap((m) => (m.kind === "server" ? [m] : []));
    for (const method of ["air", "dlc", "immersion"] as const)
      expect([method, servers.some((s) => s.cooling === method)]).toEqual([method, true]);
    // Air servers hand nothing to liquid; liquid-cooled ones hand most of their heat over.
    for (const s of servers) {
      if (s.cooling === "air") expect(s.liquidShare).toBe(0);
      else expect(s.liquidShare).toBeGreaterThan(0.5);
    }
  });

  test("plant sizes line up: a CDU is smaller than the chiller it hangs on, a generator can carry a chiller", () => {
    const biggestChiller = Math.max(
      ...catalog.list("chiller").map((m) => (m.kind === "chiller" ? m.capacityKw : 0)),
    );
    for (const cdu of catalog.list("cdu")) {
      expect(cdu.kind === "cdu" && cdu.capacityKw <= biggestChiller).toBe(true);
      expect(cdu.kind === "cdu" && cdu.pumps >= 2).toBe(true);
    }
    const plants = catalog.list("chiller").flatMap((m) => (m.kind === "chiller" ? [m] : []));
    expect(new Set(plants.map((p) => p.plant))).toEqual(
      new Set(["chiller", "dry_cooler", "cooling_tower"]),
    );
    const gens = catalog.list("generator").flatMap((m) => (m.kind === "generator" ? [m] : []));
    expect(Math.max(...gens.map((g) => g.capacityKw))).toBeGreaterThan(1000);
    expect(gens.every((g) => g.startSeconds > 0 && g.fuelLitres > 0)).toBe(true);
  });
});
