/**
 * [REQ-110] An offered scenario is one whose answer key can be reached (ADR-0172, ADR-0178), on the world generator presets giheung, hwaseong, onyang.
 * Every template that shape offers is played by the reference solution and must finish without an error and with 100.
 */
import { describe, expect, test } from "vitest";
import { OFFERED_AT_LEAST, shortOf, worldShape } from "./test-support/offered-means";

describe("an offered scenario is solved with 100 on the world generator presets giheung, hwaseong, onyang [REQ-110] [REQ-111]", () => {
  test("world giheung: every template it offers gives 100 and no error", () => {
    const { offered, short } = shortOf(worldShape("giheung"));
    expect(offered, "world giheung").toBeGreaterThanOrEqual(OFFERED_AT_LEAST.world);
    expect(short).toEqual([]);
  }, 180_000);

  test("world hwaseong: every template it offers gives 100 and no error", () => {
    const { offered, short } = shortOf(worldShape("hwaseong"));
    expect(offered, "world hwaseong").toBeGreaterThanOrEqual(OFFERED_AT_LEAST.world);
    expect(short).toEqual([]);
  }, 180_000);

  test("world onyang: every template it offers gives 100 and no error", () => {
    const { offered, short } = shortOf(worldShape("onyang"));
    expect(offered, "world onyang").toBeGreaterThanOrEqual(OFFERED_AT_LEAST.world);
    expect(short).toEqual([]);
  }, 180_000);
});
