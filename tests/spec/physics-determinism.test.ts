/**
 * [REQ-113] A world with changed numbers and tables is as deterministic as the default (ADR-0133, ADR-0137): the same
 * scenario, seed and actions give a byte-identical score breakdown on it, three times over, with and without real delay
 * between the calls. The profile's fingerprint is on the result.
 */
import { fingerprintOf, type PhysicsProfile } from "@terrarium/core/physics/slots";
import { describe, expect, test } from "vitest";
import { referenceCases } from "./test-support/reference-cases";
import { solve } from "./test-support/reference-solver";

/** Slower room, slightly lazier cooling, a table for server power and for the cap, weather over the day. */
const PROFILE: PhysicsProfile = {
  base: "v1",
  params: {
    "thermal.room.roomHeightM": 4,
    "thermal.room.envelopeWPerKM2": 3,
    "thermal.device.chipTauS": 40,
    "power.protection.tripFactor": 1.1,
    "reliability.hazard.rateScale": 1.5,
  },
  scoped: [{ param: "thermal.room.inletTauS", value: 90, scope: { kind: "room", id: "hall" } }],
  curves: {
    "power.device.utilCurve": [
      [0, 0],
      [0.5, 0.45],
      [1, 1],
    ],
    "power.device.capPerfCurve": [
      [0, 0.05],
      [0.5, 0.7],
      [1, 1],
    ],
    "cooling.unit.copCurve": [
      [0, 4],
      [40, 2.5],
    ],
    "power.protection.tripTimeCurve": [
      [1.05, 1200],
      [2, 60],
      [4, 0],
    ],
  },
  weather: {
    rows: [
      { timeS: 0, outdoorC: 18 },
      { timeS: 43_200, outdoorC: 28 },
    ],
    repeatS: 86_400,
  },
};

const SAMPLE = ["fan-failure-throttle", "wrong-vlan-port", "os-disk-full", "power-cap-rack-limit"];

const wallDelay = (ms: number) => () => {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    /* the harness is slow: real time passes, simulated time must not */
  }
};

describe("a score on a changed physics is a function of the scenario, the seed and the actions [REQ-113]", () => {
  for (const label of SAMPLE) {
    test(label, () => {
      const c = referenceCases().find((x) => x.label === label);
      if (!c) throw new Error(`no sheet ${label}`);
      const bp = { ...c.blueprint, physics: PROFILE };
      const runs = [0, 1, 2].map((i) => {
        const r = solve(bp, c.doc(), undefined, 1, i === 2 ? wallDelay(10) : undefined);
        return JSON.stringify({
          score: r.result.score,
          calls: r.calls.map((x) => [x.name, x.args]),
          physics: r.result.digests.physics,
        });
      });
      expect(runs[1]).toBe(runs[0]);
      expect(runs[2], "real delay between the calls changes nothing").toBe(runs[0]);
      expect(JSON.parse(runs[0] as string).physics).toBe(fingerprintOf(PROFILE));
    }, 120_000);
  }

  test("the result of a run on the default physics says v1", () => {
    const c = referenceCases().find((x) => x.label === "os-disk-full");
    if (!c) throw new Error("no sheet");
    expect(solve(c.blueprint, c.doc()).result.digests.physics).toBe("v1");
  }, 60_000);
});
