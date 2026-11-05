import { Catalog } from "@terrarium/core/catalog";
import { landMarket, parcelPriceM } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { DEFAULT_CAMPUS, generateCampus, SITE_PRESETS } from ".";

const catalog = new Catalog();

describe("the land of a campus costs what land costs around it [REQ-059]", () => {
  test("every campus has a market of its own", () => {
    for (const preset of SITE_PRESETS) expect(landMarket(preset.id).id).toBe(preset.id);
  });

  test("a generated campus records its market, and its parcels are priced by it", () => {
    const campus = generateCampus(
      { ...DEFAULT_CAMPUS, site: "suwon", seed: 3, buildings: 1, hallsPerFloor: 1, podsPerHall: 1 },
      catalog,
    );
    const site = campus.blueprint.entities.find((e) => e.kind === "site");
    expect(site?.props.landMarket).toBe("suwon");
    expect(site?.props.landPriceM).toBe(landMarket("suwon").perM2M);
    const parcels = campus.blueprint.entities.filter(
      (e) => e.kind === "parcel" && e.props.owned === false,
    );
    expect(parcels.length).toBeGreaterThan(0);
    for (const p of parcels) {
      const a = p.placement;
      if (a?.type !== "area") throw new Error("parcel without an area");
      expect(p.props.priceM).toBe(parcelPriceM(a.w, a.d, landMarket("suwon").perM2M));
    }
  });
});
