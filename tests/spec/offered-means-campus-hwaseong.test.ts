/**
 * [REQ-110] An offered scenario is one whose answer key can be reached (ADR-0172, ADR-0178), on the campus generator preset hwaseong:
 * every template but the domain sheets. Each template is played by the reference solution and must finish without an error and with 100.
 */
import { describe, expect, test } from "vitest";
import { campusShape, OFFERED_AT_LEAST, shortOf } from "./test-support/offered-means";

describe("an offered scenario is solved with 100 on the campus preset hwaseong, rest [REQ-110] [REQ-111]", () => {
  test("every template of this group gives 100 and no error", () => {
    const { offered, short } = shortOf(campusShape("hwaseong"), "rest");
    expect(offered).toBeGreaterThanOrEqual(OFFERED_AT_LEAST.campus);
    expect(short).toEqual([]);
  }, 300_000);
});
