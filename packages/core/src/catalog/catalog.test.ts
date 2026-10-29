import { describe, expect, test } from "vitest";
import { BUILTIN_MODELS, Catalog, DEFAULT_MODEL_BY_KIND, isRackMounted, panelCapacityW } from ".";

describe("equipment catalog [REQ-004]", () => {
  test("built-in models are unique, valid and cover every kind", () => {
    const catalog = new Catalog();
    expect(catalog.list()).toHaveLength(BUILTIN_MODELS.length);
    for (const id of Object.values(DEFAULT_MODEL_BY_KIND)) expect(catalog.has(id)).toBe(true);
    for (const model of BUILTIN_MODELS) {
      expect(model.costM).toBeGreaterThan(0);
      if (model.kind === "server") {
        expect(model.maxPowerW).toBeGreaterThan(model.idlePowerW);
        expect(model.cpuShutdownC).toBeGreaterThan(model.cpuThrottleC);
      }
    }
  });

  test("lists filter by kind in id order", () => {
    const ids = new Catalog().list("cooling_unit").map((m) => m.id);
    expect(ids).toEqual([...ids].sort((a, b) => a.localeCompare(b)));
    expect(ids).toEqual(expect.arrayContaining(["crah-100kw", "inrow-30kw"]));
    expect(new Catalog().list("cooling_unit").every((m) => m.kind === "cooling_unit")).toBe(true);
  });

  test("getOf checks the kind", () => {
    const catalog = new Catalog();
    expect(catalog.getOf("crah-100kw", "cooling_unit").capacityKw).toBe(100);
    expect(() => catalog.getOf("crah-100kw", "server")).toThrow(/expected server/);
    expect(() => catalog.get("nope")).toThrow(/unknown equipment model/);
  });

  test("custom models can be registered once, with a valid id", () => {
    const catalog = new Catalog([]);
    const model = { ...BUILTIN_MODELS[0], id: "custom-1u" } as (typeof BUILTIN_MODELS)[number];
    catalog.register(model);
    expect(catalog.get("custom-1u")).toBe(model);
    expect(() => catalog.register(model)).toThrow(/already registered/);
    expect(() => catalog.register({ ...model, id: "Bad Id" })).toThrow(/kebab-case/);
  });

  test("imported model names resolve by id, then name, then the kind's default (flagged as a guess)", () => {
    const catalog = new Catalog();
    expect(catalog.resolve("server", "srv-4u-gpu")).toMatchObject({
      model: { id: "srv-4u-gpu" },
      guessed: false,
    });
    expect(catalog.resolve("server", "4u gpu 서버")).toMatchObject({
      model: { id: "srv-4u-gpu" },
      guessed: false,
    });
    expect(catalog.resolve("server", "PowerEdge R760")).toMatchObject({
      model: { id: "srv-2u-compute" },
      guessed: true,
    });
    expect(catalog.resolve("switch", "crah-100kw")).toMatchObject({
      model: { id: "sw-tor-48x25g" },
      guessed: true,
    });
    expect(catalog.resolve("ups", undefined).guessed).toBe(true);
  });

  test("rack-mounted kinds and panel capacity", () => {
    const catalog = new Catalog();
    expect(isRackMounted(catalog.get("pdu-17kw"))).toBe(true);
    expect(isRackMounted(catalog.get("ups-500kva"))).toBe(false);
    expect(panelCapacityW(catalog.getOf("panel-400a", "power_panel"))).toBeCloseTo(250_100, -2);
  });
});
