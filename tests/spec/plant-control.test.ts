/**
 * An operator can switch the cooling plant and the generator off and on over BACnet (REQ-069, REQ-060): the
 * `Unit-Enable` point reads the switch, writing it changes the real equipment, and the physics follows, so a
 * scenario that scores "the agent switched the generator back to AUTO" is measuring something that happens.
 */
import { Catalog } from "@terrarium/core/catalog";
import { createFacades } from "@terrarium/core/facades";
import { Physics } from "@terrarium/core/physics";
import { World } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { campusBlueprint } from "../../packages/core/src/world/test-support/sample-campus";

function boot() {
  const world = World.fromBlueprint(campusBlueprint(), new Catalog());
  const physics = new Physics(world);
  physics.settle();
  physics.run(30 * 60);
  const facades = createFacades(world);
  const bacnet = (args: Record<string, unknown>) =>
    facades.bacnet.handle(args.device as string, args as never) as any;
  const enable = (device: string, value?: number | null) =>
    value === undefined
      ? bacnet({
          service: "read-property",
          device,
          objectType: "binary-output",
          instance: 1,
          property: "present-value",
        })
      : bacnet({
          service: "write-property",
          device,
          objectType: "binary-output",
          instance: 1,
          property: "present-value",
          priority: 8,
          ...(value === null ? { value: null } : { value }),
        });
  const outage = () =>
    world.apply(
      {
        type: "fault.add",
        fault: { id: "u1", type: "utility_outage", target: "ats-1", params: {} },
      },
      "test",
    );
  return { world, physics, enable, outage };
}

describe("the plant's run switch over BACnet [REQ-069] [REQ-060]", () => {
  test.each(["chiller-1", "cdu-1", "gen-1"])(
    "%s has a Unit-Enable point that reads active and can be written",
    (id) => {
      const { enable } = boot();
      expect(enable(id)).toMatchObject({ value: { value: 1 } });
      const done = enable(id, 0);
      expect(done.error).toBeUndefined();
      expect(enable(id)).toMatchObject({ value: { value: 0 } });
    },
  );

  test("a chiller switched off stops carrying load, and the loop warms; relinquishing starts it again", () => {
    const { world, physics, enable } = boot();
    const returnBefore = world.stateAs("chiller-1", "chiller").returnC;
    expect(world.stateAs("chiller-1", "chiller").running).toBe(true);
    enable("chiller-1", 0);
    physics.run(15 * 60);
    const off = world.stateAs("chiller-1", "chiller");
    expect(off).toMatchObject({ running: false, adminOn: false });
    expect(off.returnC).toBeGreaterThan(returnBefore + 3);
    // switched off by the operator is not a fault: no "stopped" alarm for it
    expect(world.alarms().map((a) => a.code)).not.toContain("chiller_stopped");
    enable("chiller-1", null);
    physics.run(10 * 60);
    expect(world.stateAs("chiller-1", "chiller").running).toBe(true);
  });

  test("a generator left OFF does not start in an outage; AUTO starts it", () => {
    const off = boot();
    off.enable("gen-1", 0);
    off.outage();
    off.physics.run(3 * 60);
    expect(off.world.stateAs("gen-1", "generator").phase).toBe("standby");
    expect(off.world.stateAs("ups-2", "ups").onBattery).toBe(true);

    off.enable("gen-1", null);
    off.physics.run(3 * 60);
    expect(off.world.stateAs("gen-1", "generator").phase).toBe("running");
  });

  test("a CDU switched off leaves the liquid-cooled rack without cooling", () => {
    const { world, physics, enable } = boot();
    const warm = world.stateAs("cdu-1", "cdu");
    expect(warm.running).toBe(true);
    enable("cdu-1", 0);
    physics.run(10 * 60);
    expect(world.stateAs("cdu-1", "cdu")).toMatchObject({ running: false, adminOn: false });
  });

  test("refused where the equipment is not the kind that has a run switch", () => {
    const { world } = boot();
    expect(() => world.apply({ type: "power.set", target: "ups-2", on: false }, "t")).toThrow(
      /cannot be powered/,
    );
    expect(() => world.apply({ type: "power.set", target: "pdu-a", on: false }, "t")).toThrow(
      /cannot be powered/,
    );
  });
});
