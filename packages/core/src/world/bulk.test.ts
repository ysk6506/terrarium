import { Catalog } from "@terrarium/core/catalog";
import { describe, expect, test } from "vitest";
import {
  type BulkLoad,
  bulkOf,
  bulkPowerW,
  bulkProps,
  bulkSlots,
  bulkUnits,
  type Entity,
  isBulkRack,
  type PropValue,
  validateBlueprint,
  World,
} from ".";
import { sampleBlueprint, withChanges } from "./test-support/sample";

const catalog = new Catalog();
const LOAD: BulkLoad = { servers: 10, modelId: "srv-2u-compute", util: 0.4, overheadW: 300 };

const lightRack = (load: Partial<BulkLoad> = {}, over: Partial<Entity> = {}): Entity => ({
  id: "rack-l",
  kind: "rack",
  name: "rack-l",
  parentId: "hall",
  placement: { type: "spot", x: 8, y: 6, rotation: 0 },
  props: bulkProps({ ...LOAD, ...load }),
  ...over,
});
const feed = { id: "lp-rack-l", kind: "power" as const, from: "rack-l", to: "pdu-a", props: {} };
const codes = (rack: Entity, withFeed = true) =>
  validateBlueprint(
    withChanges(sampleBlueprint(), { entities: [rack], links: withFeed ? [feed] : [] }),
    catalog,
  )
    .filter((i) => i.entityId === rack.id)
    .map((i) => `${i.severity}:${i.code}`);

describe("light racks count their servers instead of holding them [REQ-049]", () => {
  test("the props describe a load and read back the same", () => {
    const rack = lightRack();
    expect(isBulkRack(rack)).toBe(true);
    expect(bulkOf(rack)).toEqual(LOAD);
    expect(bulkOf({ ...rack, props: {} })).toBeUndefined();
    expect(isBulkRack({ ...rack, kind: "pdu" })).toBe(false);
  });

  test("props that do not add up make a rack that is not a light one", () => {
    const broken: Array<Record<string, PropValue>> = [
      { bulkServers: -1 },
      { bulkServers: 2.5 },
      { bulkModel: "" },
      { bulkModel: 7 },
      { bulkUtil: "high" },
      { bulkOverheadW: -5 },
    ];
    for (const bad of broken) {
      const rack = lightRack();
      expect(bulkOf({ ...rack, props: { ...rack.props, ...bad } })).toBeUndefined();
    }
    // Utilisation outside 0..1 is clamped rather than refused.
    const rack = lightRack();
    expect(bulkOf({ ...rack, props: { ...rack.props, bulkUtil: 3 } })?.util).toBe(1);
  });

  test("power, units and slots follow from the server model", () => {
    const model = catalog.getOf("srv-2u-compute", "server");
    expect(bulkPowerW(LOAD, model)).toBeCloseTo(
      300 + 10 * (model.idlePowerW + 0.4 * (model.maxPowerW - model.idlePowerW)),
    );
    expect(bulkPowerW(LOAD, model, 0)).toBe(300 + 10 * model.idlePowerW);
    expect(bulkUnits(LOAD, model)).toBe(10 * model.uHeight + 1);
    const slots = bulkSlots(LOAD, model);
    expect(slots).toHaveLength(10);
    expect(slots[0]).toBe(1);
    expect(slots[9]).toBe(1 + 9 * model.uHeight);
  });

  test("a well-formed light rack with a feed has no problems", () => {
    expect(codes(lightRack())).toEqual([]);
  });

  test("the validator says what is wrong with a light rack", () => {
    const broken = lightRack();
    expect(codes({ ...broken, props: { bulk: true, bulkServers: "many" } })).toEqual([
      "error:W050",
    ]);
    expect(codes(lightRack({ modelId: "nope" }))).toEqual(["error:W051"]);
    expect(codes(lightRack({ modelId: "pdu-17kw" }))).toEqual(["error:W051"]);
    // 42U: twenty-one 2U servers and the switch do not fit.
    expect(codes(lightRack({ servers: 21 }))).toEqual(["error:W052"]);
    // An immersion-only server does not belong in an air rack.
    expect(codes(lightRack({ modelId: "sm-2u-imm", servers: 4 }))).toEqual(["error:W030"]);
    expect(codes(lightRack(), false)).toEqual(["warning:W054"]);
  });

  test("a light rack that also holds a device of its own is refused", () => {
    const server: Entity = {
      id: "srv-x",
      kind: "server",
      name: "srv-x",
      parentId: "rack-l",
      modelId: "srv-1u-compute",
      placement: { type: "unit", u: 30 },
      props: {},
    };
    const bp = withChanges(sampleBlueprint(), {
      entities: [lightRack({ servers: 4 }), server],
      links: [feed],
    });
    expect(validateBlueprint(bp, catalog).map((i) => i.code)).toContain("W053");
  });

  test("load can be set on a light rack, and only on a light one", () => {
    const bp = withChanges(sampleBlueprint(), { entities: [lightRack()], links: [feed] });
    const world = World.fromBlueprint(bp, catalog);
    expect(world.stateAs("rack-l", "rack").util).toBe(0.4);
    world.apply({ type: "load.set", target: "rack-l", value: 0.9 }, "scenario");
    expect(world.stateAs("rack-l", "rack").util).toBe(0.9);
    expect(() =>
      world.apply({ type: "load.set", target: "rack-a", value: 0.5 }, "scenario"),
    ).toThrow(/light racks/);
  });
});
