import { Catalog } from "@terrarium/core/catalog";
import { type Blueprint, type Entity, type Link, World } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { sampleBlueprint, withChanges } from "../world/test-support/sample";
import { campusBlueprint } from "../world/test-support/sample-campus";
import { Physics } from ".";

const catalog = new Catalog();
const MINUTE = 60;

const inject = (world: World, id: string, type: string, target: string, factor?: number) =>
  world.apply(
    {
      type: "fault.add",
      fault: { id, type: type as never, target, params: factor === undefined ? {} : { factor } },
    },
    "scenario",
  );
const hits = (world: World, entityId: string) =>
  world
    .alarms()
    .filter((a) => a.entityId === entityId)
    .map((a) => `${a.code}/${a.severity}`)
    .sort();

const gpuServer = (id: string, rack: string, u: number, modelId: string): Entity => ({
  id,
  kind: "server",
  name: id,
  parentId: rack,
  modelId,
  placement: { type: "unit", u },
  props: { cpuUtil: 1 },
});
const power = (from: string, to: string): Link => ({
  id: `lp-${from}`,
  kind: "power",
  from,
  to,
  props: {},
});

/**
 * The campus sample with a rear-door rack whose door hangs straight on the chiller, and a heavily
 * loaded direct-liquid rack on the CDU behind the same chiller.
 */
function withRearDoor(): Blueprint {
  const bp = campusBlueprint();
  const rack: Entity = {
    id: "rack-d",
    kind: "rack",
    name: "rack-d",
    parentId: "hall",
    modelId: "aq-45u-rdhx",
    placement: { type: "spot", x: 9, y: 1, rotation: 0 },
    props: {},
  };
  const servers = [6, 10, 14, 18, 22, 26, 30, 34].map((u) =>
    gpuServer(`srv-d${u}`, "rack-d", u, "srv-4u-gpu"),
  );
  const dlc = Array.from({ length: 8 }, (_, i) =>
    gpuServer(`srv-l${i + 2}`, "rack-l", 14 + i * 4, "ax-4u-8gpu-dlc"),
  );
  return {
    ...bp,
    entities: [...bp.entities, rack, ...servers, ...dlc],
    links: [
      ...bp.links,
      ...[...servers, ...dlc].map((s) => power(s.id, "ups-2")),
      { id: "lc-rack-d", kind: "cooling", from: "rack-d", to: "chiller-1", props: {} },
    ],
  };
}

describe("cooling plant edge cases [REQ-044]", () => {
  test("a rear door hanging straight on a chiller takes its share of the heat, and none when the chiller stops", () => {
    const world = World.fromBlueprint(withRearDoor(), catalog);
    const physics = new Physics(world);
    physics.settle();
    physics.run(10 * MINUTE);
    const door = world.stateAs("rack-d", "rack");
    expect(door.liquidW / door.powerW).toBeCloseTo(0.75, 1);
    expect(world.stateAs("chiller-1", "chiller").loadKw * 1000).toBeGreaterThan(door.liquidW);

    inject(world, "c1", "chiller_failure", "chiller-1");
    physics.run(MINUTE);
    expect(world.stateAs("rack-d", "rack").liquidW).toBe(0);
  });

  test("a chiller asked for more than it can give raises an overload warning", () => {
    const world = World.fromBlueprint(withRearDoor(), catalog);
    const physics = new Physics(world);
    physics.settle();
    physics.run(10 * MINUTE);
    expect(hits(world, "chiller-1")).toEqual([]);
    inject(world, "weak", "chiller_degraded", "chiller-1", 0.05);
    physics.run(MINUTE);
    const s = world.stateAs("chiller-1", "chiller");
    expect(s.loadKw).toBeGreaterThan(s.capacityKw);
    expect(hits(world, "chiller-1")).toContain("chiller_overload/warning");
  });

  test("a PDU past 80% of its rating warns before the breaker trips", () => {
    const busy = gpuServer("gpu-1", "rack-b", 26, "srv-4u-gpu");
    const light = { ...gpuServer("gpu-2", "rack-b", 32, "srv-4u-gpu"), props: { cpuUtil: 0.3 } };
    // A busy GPU server and a lightly used one on top of what the PDU already carries land between the
    // warning (80%) and the trip point (100%).
    const bp = withChanges(sampleBlueprint(), {
      entities: [busy, light],
      links: [power("gpu-1", "pdu-b"), power("gpu-2", "pdu-b")],
    });
    const world = World.fromBlueprint(bp, catalog);
    const physics = new Physics(world);
    physics.settle();
    physics.run(5 * MINUTE);
    const pdu = world.stateAs("pdu-b", "pdu");
    const rated = catalog.getOf("pdu-11kw", "pdu").capacityW;
    expect(pdu.tripped).toBe(false);
    expect(pdu.loadW).toBeGreaterThan(0.8 * rated);
    expect(pdu.loadW).toBeLessThan(rated);
    expect(hits(world, "pdu-b")).toContain("load_high/warning");
  });
});
