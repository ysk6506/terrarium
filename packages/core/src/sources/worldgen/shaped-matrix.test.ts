import { LADDER, LAYER_IDS } from "@terrarium/core/world";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SHAPE,
  defaultSize,
  generateShaped,
  planShape,
  type ShapeSpec,
  shapeProblem,
  sizeFields,
  worldTotals,
} from "./index";

const sized = (over: Partial<ShapeSpec> = {}): ShapeSpec => ({
  ...DEFAULT_SHAPE,
  ...sizeFields(defaultSize(DEFAULT_SHAPE.services)),
  ...over,
});

describe("shaped worlds built from other starting points [REQ-111]", () => {
  it("[REQ-111] every modelled chip on the default layers builds a world the plan counted", () => {
    let tried = 0;
    for (const layer of LAYER_IDS)
      for (const chip of LADDER[layer]) {
        const s = sized({ layers: { ...DEFAULT_SHAPE.layers, [layer]: chip.id } });
        if (shapeProblem(s)) continue;
        expect(generateShaped(s).counts.racks, `${layer}:${chip.id}`).toBe(
          worldTotals(planShape(s)).racks,
        );
        tried += 1;
      }
    expect(tried).toBeGreaterThan(40);
  });

  it("[REQ-111] a site as it really is builds a campus", () => {
    const built = generateShaped({ ...DEFAULT_SHAPE, real: true });
    expect(built.blueprint.entities.length).toBeGreaterThan(100);
    expect(generateShaped({ ...DEFAULT_SHAPE, real: true }).blueprint).toEqual(built.blueprint);
  });
});
