/**
 * [REQ-110] An offered scenario is one whose answer key can be reached (ADR-0172, ADR-0178), on the ladder chip shapes, part 2 of 3.
 * Every template that shape offers is played by the reference solution and must finish without an error and with 100.
 */
import { describe, expect, test } from "vitest";
import { ladderPart, OFFERED_AT_LEAST, shortOf } from "./test-support/offered-means";

describe("an offered scenario is solved with 100 on the ladder chip shapes, part 2 of 3 [REQ-110] [REQ-111]", () => {
  for (const shape of ladderPart(1, 3)) {
    test(`${shape.id}: every template it offers gives 100 and no error`, () => {
      const { offered, short } = shortOf(shape);
      expect(offered, shape.id).toBeGreaterThanOrEqual(OFFERED_AT_LEAST.ladder);
      expect(short).toEqual([]);
    }, 180_000);
  }
});
