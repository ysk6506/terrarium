import { Catalog } from "@terrarium/core/catalog";
import { describe, expect, test } from "vitest";
import {
  BlueprintIndex,
  BUILD_RATE_M_PER_M2,
  CONTAINMENT_RATE_M_PER_M2,
  type Entity,
  emptyBlueprint,
  FIT_OUT_RATE_M_PER_M2,
  LAND_MARKETS,
  landMarket,
  parcelPriceM,
  structureCostM,
} from ".";

const catalog = new Catalog();

const e = (partial: Partial<Entity> & Pick<Entity, "id" | "kind">): Entity => ({
  name: partial.id,
  props: {},
  ...partial,
});

function campus(purpose?: string) {
  const entities: Entity[] = [
    e({ id: "s", kind: "site", placement: { type: "land", w: 300, d: 200 } }),
    e({
      id: "b",
      kind: "building",
      parentId: "s",
      placement: { type: "area", x: 10, y: 10, w: 50, d: 40 },
      props: purpose ? { purpose } : {},
    }),
    e({
      id: "f",
      kind: "floor",
      parentId: "b",
      placement: { type: "level", level: 1, height: 4.5 },
    }),
    e({
      id: "r",
      kind: "room",
      parentId: "f",
      placement: { type: "area", x: 1, y: 1, w: 20, d: 10 },
    }),
    e({
      id: "c",
      kind: "containment",
      parentId: "r",
      placement: { type: "area", x: 2, y: 2, w: 6, d: 3.6 },
      props: { aisle: "cold" },
    }),
  ];
  return new BlueprintIndex({ ...emptyBlueprint("t", "t"), entities });
}

describe("what the building around the equipment costs [REQ-059]", () => {
  test("a floor costs its building's footprint at the building's rate, and a fab costs more than a utility building", () => {
    const cost = (purpose?: string) => {
      const index = campus(purpose);
      return structureCostM(index, catalog, index.entity("f"));
    };
    expect(cost()).toBe(50 * 40 * BUILD_RATE_M_PER_M2.data_center);
    expect(cost("fab")).toBe(50 * 40 * BUILD_RATE_M_PER_M2.fab);
    expect(cost("fab")).toBeGreaterThan(cost("data_center"));
    expect(cost("data_center")).toBeGreaterThan(cost("utility"));
  });

  test("a room costs its fit-out by purpose, a containment its frame, and nothing else has a structure", () => {
    const index = campus();
    expect(structureCostM(index, catalog, index.entity("r"))).toBe(
      20 * 10 * FIT_OUT_RATE_M_PER_M2.data_hall,
    );
    expect(structureCostM(index, catalog, index.entity("c"))).toBeCloseTo(
      6 * 3.6 * CONTAINMENT_RATE_M_PER_M2,
      6,
    );
    expect(structureCostM(index, catalog, index.entity("b"))).toBe(0);
    expect(structureCostM(index, catalog, index.entity("s"))).toBe(0);
  });

  test("the rates stay near what building really costs: a data centre floor is 평당 1,000~2,000만 원", () => {
    const pyeong = 3.3058;
    const perPyeong = BUILD_RATE_M_PER_M2.data_center * pyeong * 100; // 만 원
    expect(perPyeong).toBeGreaterThan(1000);
    expect(perPyeong).toBeLessThan(2000);
    // A fab is the dearest, and a cleanroom the dearest room.
    expect(BUILD_RATE_M_PER_M2.fab).toBeGreaterThan(BUILD_RATE_M_PER_M2.research);
    expect(Math.max(...Object.values(FIT_OUT_RATE_M_PER_M2))).toBe(FIT_OUT_RATE_M_PER_M2.cleanroom);
  });
});

describe("what land costs where it lies [REQ-059]", () => {
  test("an unknown place falls back to ordinary factory land", () => {
    expect(landMarket("nowhere").id).toBe("general");
    expect(landMarket(undefined).id).toBe("general");
  });

  test("a price is stated per ㎡ in million won, says whether it was found or estimated, and says from what", () => {
    for (const m of LAND_MARKETS) {
      expect(m.perM2M).toBeGreaterThan(0.3);
      expect(m.perM2M).toBeLessThan(10);
      expect(["reported", "estimated"]).toContain(m.basis);
      expect(m.note.length).toBeGreaterThan(10);
    }
    expect(parcelPriceM(100, 100, landMarket("suwon").perM2M)).toBe(45000);
    expect(landMarket("suwon").perM2M).toBeGreaterThan(landMarket("hwaseong").perM2M);
    expect(landMarket("hwaseong").perM2M).toBeGreaterThan(landMarket("cheonan").perM2M);
  });
});

describe("what equipment costs [REQ-059]", () => {
  test("a GPU server costs 30~130 million won per GPU, as 8-GPU HGX servers do (about 22,000~97,000 dollars each; B300 is the dearest)", () => {
    for (const model of catalog.list()) {
      if (model.kind !== "server" || model.gpus === 0) continue;
      const each = model.costM / model.gpus;
      expect(each, model.id).toBeGreaterThan(30);
      expect(each, model.id).toBeLessThan(130);
    }
  });

  test("UPS and generators cost what they do per kW: UPS 0.4~1 million won, diesel 0.25~0.6", () => {
    for (const model of catalog.list()) {
      if (model.kind === "ups") {
        const each = model.costM / model.capacityKw;
        expect(each, model.id).toBeGreaterThan(0.4);
        expect(each, model.id).toBeLessThan(1);
      }
      if (model.kind === "generator") {
        const each = model.costM / model.capacityKw;
        expect(each, model.id).toBeGreaterThan(0.25);
        expect(each, model.id).toBeLessThan(0.6);
      }
    }
  });
});
