/**
 * [REQ-113] The numbers, tables and weather of a physics profile reach the engine through the slots (ADR-0137): a world with
 * no profile, an empty one, and one that only restates the defaults all run the same bits as before slots existed; a changed
 * number or table changes exactly what it says it changes.
 */
import { Catalog } from "@terrarium/core/catalog";
import { hashValue } from "@terrarium/core/kernel";
import { ambientDerate, drawW, Physics } from "@terrarium/core/physics";
import {
  defaultsOf,
  fingerprintOf,
  type PhysicsProfile,
  resolveProfile,
} from "@terrarium/core/physics/slots";
import { type Blueprint, blueprintDigest, type Entity, World } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { sampleBlueprint, withChanges } from "../../packages/core/src/world/test-support/sample";

const catalog = new Catalog();

const withPhysics = (physics?: PhysicsProfile, bp: Blueprint = sampleBlueprint()): Blueprint =>
  physics ? { ...bp, physics } : bp;

function boot(physics?: PhysicsProfile, bp?: Blueprint): { world: World; engine: Physics } {
  const world = World.fromBlueprint(withPhysics(physics, bp), catalog);
  const engine = new Physics(world);
  engine.settle();
  return { world, engine };
}

const stateHash = (w: World): string => hashValue({ s: w.snapshot().state, q: w.lastSeq() });

const gpu = (id: string, u: number): Entity => ({
  id,
  kind: "server",
  name: id,
  parentId: "rack-b",
  modelId: "srv-4u-gpu",
  placement: { type: "unit", u },
  props: { cpuUtil: 1 },
});

describe("a profile that changes nothing changes nothing [REQ-113]", () => {
  const restated: PhysicsProfile = {
    base: "v1",
    params: {
      "thermal.room.roomHeightM": defaultsOf("thermal.room").roomHeightM,
      "power.protection.tripFactor": defaultsOf("power.protection").tripFactor,
    },
    curves: {},
    scoped: [],
  };

  test("no profile, an empty one and one that restates the defaults give the same bits and the same digest", () => {
    const runs = [undefined, { base: "v1" } as PhysicsProfile, restated].map((p) => {
      const { world, engine } = boot(p);
      engine.run(900);
      return stateHash(world);
    });
    expect(runs[1]).toBe(runs[0]);
    expect(runs[2]).toBe(runs[0]);
    const digests = [undefined, { base: "v1" } as PhysicsProfile, restated].map((p) =>
      blueprintDigest(withPhysics(p)),
    );
    expect(new Set(digests).size).toBe(1);
    expect(fingerprintOf(restated)).toBe("v1");
  });

  test("a world with other physics is another version of the world: its digest differs", () => {
    const changed: PhysicsProfile = { base: "v1", params: { "thermal.room.roomHeightM": 4 } };
    expect(blueprintDigest(withPhysics(changed))).not.toBe(blueprintDigest(withPhysics()));
    expect(World.fromBlueprint(withPhysics(changed), catalog).physics.fingerprint).toBe(
      fingerprintOf(changed),
    );
    expect(World.fromBlueprint(withPhysics(), catalog).physics.fingerprint).toBe("v1");
  });

  test("a profile the engine cannot use refuses the world, in Korean", () => {
    const bad = withPhysics({ base: "v1", params: { "thermal.room.roomHeightM": 99 } });
    expect(() => World.fromBlueprint(bad, catalog)).toThrow(/물리 프로필: .*허용 범위/);
  });
});

describe("a number changed is a number the engine follows [REQ-113]", () => {
  const BOTH_OFF = ["crah-1", "crah-2"];
  const heatUp = (physics?: PhysicsProfile): number => {
    const { world, engine } = boot(physics);
    engine.run(600);
    for (const [k, id] of BOTH_OFF.entries()) {
      world.apply(
        {
          type: "fault.add",
          fault: { id: `off-${k}`, type: "cooling_unit_failure", target: id, params: {} },
        },
        "test",
      );
    }
    engine.run(900);
    return world.stateAs("hall", "room").ambientC;
  };

  test("a lower ceiling means less air to heat: the room warms faster once cooling stops", () => {
    const base = heatUp();
    const low = heatUp({ base: "v1", params: { "thermal.room.roomHeightM": 1 } });
    expect(low).toBeGreaterThan(base + 1);
  });

  test("the same number for the room alone does the same; for another place it does nothing", () => {
    const world = heatUp({ base: "v1", params: { "thermal.room.roomHeightM": 1 } });
    const room = heatUp({
      base: "v1",
      scoped: [
        { param: "thermal.room.roomHeightM", value: 1, scope: { kind: "room", id: "hall" } },
      ],
    });
    const building = heatUp({
      base: "v1",
      scoped: [
        { param: "thermal.room.roomHeightM", value: 1, scope: { kind: "building", id: "bldg" } },
      ],
    });
    const elsewhere = heatUp({
      base: "v1",
      scoped: [
        { param: "thermal.room.roomHeightM", value: 1, scope: { kind: "room", id: "other" } },
      ],
    });
    expect(room).toBe(world);
    expect(building).toBe(world);
    expect(elsewhere).toBe(heatUp());
  });

  test("a bigger trip factor holds a breaker that the default drops", () => {
    const overloaded = withChanges(sampleBlueprint(), {
      entities: [gpu("gpu-1", 26), gpu("gpu-2", 32)],
      links: [
        { id: "lp-1", kind: "power", from: "gpu-1", to: "pdu-b", props: {} },
        { id: "lp-2", kind: "power", from: "gpu-2", to: "pdu-b", props: {} },
      ],
    });
    const tripped = (physics?: PhysicsProfile): boolean => {
      const { world, engine } = boot(physics, overloaded);
      for (const id of ["gpu-1", "gpu-2"])
        world.apply({ type: "load.set", target: id, value: 1 }, "test");
      engine.run(120);
      return world.stateAs("pdu-b", "pdu").tripped;
    };
    expect(tripped()).toBe(true);
    expect(tripped({ base: "v1", params: { "power.protection.tripFactor": 3 } })).toBe(false);
  });

  test("the failure-rate numbers reach the generator: a scale on all of them changes the plan", async () => {
    const { planFaults, candidatesOf } = await import("@terrarium/core/session");
    const world = World.fromBlueprint(sampleBlueprint(), catalog);
    const config = {
      hours: 24,
      pace: "fast",
      source: { kind: "preset", preset: "normal" },
      cascadeChance: 0,
      simultaneousChance: 0,
      instruction: "x",
    } as never;
    const plain = planFaults(candidatesOf(world), config, 3);
    const doubled = planFaults(
      candidatesOf(world),
      config,
      3,
      resolveProfile({ base: "v1", params: { "reliability.hazard.rateScale": 2 } }).base(
        "reliability.hazard",
      ),
    );
    expect(doubled.length).toBeGreaterThan(plain.length);
  });
});

describe("a table swapped in for a formula is followed, and only then [REQ-113]", () => {
  test("server power over utilisation: the table sets how much of the range is drawn", () => {
    const watts = (physics?: PhysicsProfile): number => {
      const { world, engine } = boot(physics);
      world.apply({ type: "load.set", target: "srv-b1", value: 0.5 }, "test");
      engine.run(30);
      return world.stateAs("srv-b1", "server").powerW;
    };
    const model = catalog.getOf("srv-1u-compute", "server");
    const half = watts();
    expect(half).toBeCloseTo(model.idlePowerW + (model.maxPowerW - model.idlePowerW) * 0.5, 6);
    const curved = watts({
      base: "v1",
      curves: {
        "power.device.utilCurve": [
          [0, 0],
          [0.5, 0.9],
          [1, 1],
        ],
      },
    });
    expect(curved).toBeCloseTo(model.idlePowerW + (model.maxPowerW - model.idlePowerW) * 0.9, 6);
  });

  test("cap to speed: the table replaces the 0.4 power", () => {
    const perf = (physics?: PhysicsProfile): number => {
      const { world, engine } = boot(physics);
      world.apply({ type: "load.set", target: "srv-b1", value: 1 }, "test");
      const model = catalog.getOf("srv-1u-compute", "server");
      world.apply(
        {
          type: "power.cap",
          target: "srv-b1",
          watts: model.idlePowerW + (model.maxPowerW - model.idlePowerW) / 2,
        },
        "test",
      );
      engine.run(30);
      return world.stateAs("srv-b1", "server").perf ?? -1;
    };
    expect(perf()).toBeCloseTo(0.5 ** 0.4, 9);
    expect(
      perf({
        base: "v1",
        curves: {
          "power.device.capPerfCurve": [
            [0, 0],
            [1, 1],
          ],
        },
      }),
    ).toBeCloseTo(0.5, 9);
  });

  test("the cooling unit's work follows a COP table over the outdoor air", () => {
    const draw = (physics?: PhysicsProfile): number => {
      const { world, engine } = boot(physics);
      engine.run(600);
      return drawW(world, "crah-1");
    };
    const unit = catalog.getOf("crah-100kw", "cooling_unit");
    const plain = draw();
    const better = draw({
      base: "v1",
      curves: {
        "cooling.unit.copCurve": [
          [-50, 6],
          [70, 6],
        ],
      },
    });
    expect(plain).toBeGreaterThan(unit.fanPowerW);
    expect(better).toBeLessThan(plain);
    expect(better).toBeGreaterThan(unit.fanPowerW);
  });

  test("a plant keeps its share of capacity by a table over the outdoor air; without one, the formula", () => {
    const v1 = defaultsOf("cooling.plant");
    expect(ambientDerate("dry_cooler", 35, v1)).toBeCloseTo(1.1 - 0.01 * 20, 12);
    expect(ambientDerate("chiller", 40, v1)).toBeCloseTo(0.85, 12);
    expect(
      ambientDerate("cooling_tower", 35, v1, [
        [0, 1],
        [50, 0.5],
      ]),
    ).toBeCloseTo(0.65, 12);
  });

  test("a UPS carries its load over an efficiency table: the supplier behind it carries more when the table is lower", () => {
    const upsLoad = (physics?: PhysicsProfile): number => {
      const { world, engine } = boot(physics);
      engine.run(60);
      return world.stateAs("ups-1", "ups").loadW;
    };
    const panel = (physics?: PhysicsProfile): number => {
      const { world, engine } = boot(physics);
      engine.run(60);
      return world.stateAs("panel-1", "power_panel").loadW;
    };
    expect(
      upsLoad({
        base: "v1",
        curves: {
          "power.conversion.upsEfficiencyCurve": [
            [0, 0.5],
            [1, 0.5],
          ],
        },
      }),
    ).toBeCloseTo(panel(), 3);
  });
});

describe("a breaker with a trip curve holds on for the time the curve gives [REQ-113]", () => {
  const overloaded = withChanges(sampleBlueprint(), {
    entities: [gpu("gpu-1", 26), gpu("gpu-2", 32)],
    links: [
      { id: "lp-1", kind: "power", from: "gpu-1", to: "pdu-b", props: {} },
      { id: "lp-2", kind: "power", from: "gpu-2", to: "pdu-b", props: {} },
    ],
  });
  const curve = (seconds: number): PhysicsProfile => ({
    base: "v1",
    curves: {
      "power.protection.tripTimeCurve": [
        [1, seconds],
        [20, seconds],
      ],
    },
  });
  const overload = (physics?: PhysicsProfile) => {
    const { world, engine } = boot(physics, overloaded);
    for (const id of ["gpu-1", "gpu-2"])
      world.apply({ type: "load.set", target: id, value: 1 }, "test");
    return { world, engine };
  };

  test("it trips after about the seconds of the curve, not on the first step", () => {
    const { world, engine } = overload(curve(300));
    engine.run(200);
    expect(world.stateAs("pdu-b", "pdu").tripped).toBe(false);
    expect(world.stateAs("pdu-b", "pdu").overload).toBeGreaterThan(0.5);
    engine.run(150);
    expect(world.stateAs("pdu-b", "pdu").tripped).toBe(true);
  });

  test("a curve that says 0 seconds trips on the step, as the default does", () => {
    const { world, engine } = overload(curve(0));
    engine.run(30);
    expect(world.stateAs("pdu-b", "pdu").tripped).toBe(true);
  });

  test("when the load goes away the heat drains and the breaker holds", () => {
    const { world, engine } = overload(curve(300));
    engine.run(200);
    for (const id of ["gpu-1", "gpu-2"])
      world.apply({ type: "load.set", target: id, value: 0 }, "test");
    engine.run(600);
    expect(world.stateAs("pdu-b", "pdu").tripped).toBe(false);
    expect(world.stateAs("pdu-b", "pdu").overload).toBeUndefined();
  });
});

describe("the weather table sets the outdoor air; a scenario's own change comes first [REQ-113]", () => {
  test("outdoor air follows the table over the day", () => {
    const profile: PhysicsProfile = {
      base: "v1",
      weather: {
        rows: [
          { timeS: 0, outdoorC: 10 },
          { timeS: 43_200, outdoorC: 30 },
        ],
        repeatS: 86_400,
      },
    };
    const { world, engine } = boot(profile);
    expect(world.outdoorC()).toBe(10);
    engine.run(21_600);
    expect(world.outdoorC()).toBeCloseTo(20, 9);
    world.apply({ type: "outdoor.set", celsius: 41 }, "scenario");
    expect(world.outdoorC()).toBe(41);
  });

  test("without a table the outdoor air is the default of the weather slot, 25 °C", () => {
    expect(boot().world.outdoorC()).toBe(25);
    expect(
      boot({ base: "v1", params: { "env.weather.defaultOutdoorC": 31 } }).world.outdoorC(),
    ).toBe(31);
  });
});
