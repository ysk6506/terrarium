/**
 * [REQ-110] An offered scenario is one whose answer key can be reached (ADR-0172, ADR-0178), on the world generator presets cheonan, suwon, pyeongtaek.
 * Every template that shape offers is played by the reference solution and must finish without an error and with 100.
 */
import { describe, expect, test } from "vitest";
import { OFFERED_AT_LEAST, shortOf, worldShape } from "./test-support/offered-means";

describe("an offered scenario is solved with 100 on the world generator presets cheonan, suwon, pyeongtaek [REQ-110] [REQ-111]", () => {
  test("world cheonan: every template it offers gives 100 and no error", () => {
    const { offered, short } = shortOf(worldShape("cheonan"));
    expect(offered, "world cheonan").toBeGreaterThanOrEqual(OFFERED_AT_LEAST.world);
    expect(short).toEqual([]);
  }, 180_000);

  test("world suwon: every template it offers gives 100 and no error", () => {
    const { offered, short } = shortOf(worldShape("suwon"));
    expect(offered, "world suwon").toBeGreaterThanOrEqual(OFFERED_AT_LEAST.world);
    expect(short).toEqual([]);
  }, 180_000);

  test("world pyeongtaek: every template it offers gives 100 and no error", () => {
    const { offered, short } = shortOf(worldShape("pyeongtaek"));
    expect(offered, "world pyeongtaek").toBeGreaterThanOrEqual(OFFERED_AT_LEAST.world);
    expect(short).toEqual([]);
  }, 180_000);
});
