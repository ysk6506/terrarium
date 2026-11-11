/**
 * [REQ-113] A physics profile is held to the reference solution (ADR-0133, ADR-0137): on the default physics the
 * reference scores 100; on a profile that makes a room heat much faster, a sheet that needs the room kept cool in time
 * is no longer winnable for full marks, and the hook lists it (such a sheet is left out of that profile's benchmark).
 */
import type { PhysicsProfile } from "@terrarium/core/physics/slots";
import { describe, expect, test } from "vitest";
import { validateProfileAgainstReference } from "./test-support/reference-profile";

/** The room holds a tenth of the heat it did: everything that depends on the room staying cool runs out of time. */
const HOT: PhysicsProfile = {
  base: "v1",
  params: { "thermal.room.airJPerKM3": 500, "thermal.room.roomHeightM": 1 },
};

/** The sheets about cooling and fans, where the room's heat holds decide the score. */
const THERMAL = (label: string) => /cool|fan|thermal|hot|heat/.test(label);

describe("the reference solution on a profile [REQ-113]", () => {
  test("on the default physics it scores 100 on the sheets it is tried on", () => {
    const check = validateProfileAgainstReference({ base: "v1" }, { only: THERMAL });
    expect(check.checked).toBeGreaterThan(0);
    expect(check.failing).toEqual([]);
  }, 300_000);

  test("on a profile that makes the room heat much faster, the hook lists the sheets that can no longer be won", () => {
    const check = validateProfileAgainstReference(HOT, { only: THERMAL });
    expect(check.checked).toBeGreaterThan(0);
    expect(check.failing.length).toBeGreaterThan(0);
    for (const f of check.failing) {
      expect(f.total).toBeLessThan(100);
      expect(f.short.length).toBeGreaterThan(0);
    }
  }, 300_000);
});
