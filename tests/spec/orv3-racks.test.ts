/**
 * OCP Open Rack v3 beside the 19-inch rack (REQ-063, ADR-0060): the rack standard decides what mounts in
 * it, how tall one unit is, and how it is powered (power shelves on a 48 V busbar instead of outlet PDUs).
 */
import { BUILTIN_MODELS, Catalog, mountOfModel } from "@terrarium/core/catalog";
import { type FacadeRequest, RedfishFacade } from "@terrarium/core/facades";
import { Physics } from "@terrarium/core/physics";
import { ProfileRegistry } from "@terrarium/core/profiles";
import {
  absolutePosition,
  type Blueprint,
  BlueprintIndex,
  type Entity,
  outletCount,
  rackStandardOf,
  unitHeightM,
  validateBlueprint,
  World,
} from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { sampleBlueprint, withChanges } from "../../packages/core/src/world/test-support/sample";
import { crawl, schemaErrors } from "./redfish-schemas/validator";

const catalog = new Catalog();

const at = (
  id: string,
  kind: Entity["kind"],
  parentId: string,
  placement: Entity["placement"],
  modelId: string,
): Entity => ({ id, kind, name: id, parentId, placement, modelId, props: {} });

let seq = 0;
const link = (kind: "power" | "cooling", from: string, to: string) => ({
  id: `o-${kind}-${from}-${to}-${seq++}`,
  kind,
  from,
  to,
  props: {},
});

/** The sample hall with an ORv3 rack: a power shelf on the panel, two sleds on the shelf, a ToR switch. */
function withOrv3(extra: Entity[] = [], rackModel = "orv3-48ou-std"): Blueprint {
  return withChanges(sampleBlueprint(), {
    entities: [
      at("rack-o", "rack", "ca1", { type: "spot", x: 2.7, y: 3.0, rotation: 0 }, rackModel),
      at("shelf-o", "pdu", "rack-o", { type: "unit", u: 1 }, "orv3-shelf-18kw"),
      at("sled-o1", "server", "rack-o", { type: "unit", u: 10 }, "orv3-cpu-1ou"),
      at("sled-o2", "server", "rack-o", { type: "unit", u: 12 }, "orv3-cpu-1ou"),
      at("tor-o", "switch", "rack-o", { type: "unit", u: 40 }, "orv3-tor-32x100g"),
      ...extra,
    ],
    links: [
      link("power", "sled-o1", "shelf-o"),
      link("power", "sled-o2", "shelf-o"),
      link("power", "tor-o", "shelf-o"),
      link("power", "shelf-o", "panel-1"),
      link("cooling", "rack-o", "crah-1"),
    ],
  });
}

const errorsOf = (bp: Blueprint) =>
  validateBlueprint(bp, catalog)
    .filter((i) => i.severity === "error")
    .map((i) => `${i.code}@${i.entityId}`);

describe("the catalog has ORv3 beside EIA-310 [REQ-063] [REQ-004]", () => {
  test("every ORv3 piece says so, and everything older stays 19-inch", () => {
    const orv3 = BUILTIN_MODELS.filter(
      (m) => mountOfModel(m) === "orv3" || (m.kind === "rack" && m.standard === "orv3"),
    );
    expect(orv3.map((m) => m.id).sort()).toEqual([
      "orv3-48ou-hpr-dlc",
      "orv3-48ou-std",
      "orv3-cpu-1ou",
      "orv3-gpu-2ou",
      "orv3-gpu-2ou-dlc",
      "orv3-shelf-18kw",
      "orv3-shelf-33kw",
      "orv3-tor-32x100g",
    ]);
    for (const id of ["rack-42u-std", "srv-2u-compute", "sw-tor-48x25g", "pdu-17kw"])
      expect(mountOfModel(catalog.get(id))).toBe("eia310");
  });

  test("the shelves feed a busbar (no outlets); the HPR rack is liquid-cooled and carries more", () => {
    for (const id of ["orv3-shelf-18kw", "orv3-shelf-33kw"]) {
      const shelf = catalog.getOf(id, "pdu");
      expect(shelf).toMatchObject({ shelf: true, outlets: 0, uHeight: 1 });
    }
    const std = catalog.getOf("orv3-48ou-std", "rack");
    const hpr = catalog.getOf("orv3-48ou-hpr-dlc", "rack");
    expect([std.uHeight, std.footprint]).toEqual([48, { w: 0.6, d: 1.068 }]);
    expect(hpr.cooling).toBe("dlc");
    expect(hpr.maxKw).toBeGreaterThan(std.maxKw * 2);
  });
});

describe("the rack standard decides what mounts and how tall a unit is [REQ-063]", () => {
  test("a rack with ORv3 sleds, a shelf and an ORv3 switch is a valid blueprint", () => {
    expect(errorsOf(withOrv3())).toEqual([]);
  });

  test("a 19-inch server in an ORv3 rack, or a sled in a 19-inch rack, does not mount", () => {
    const eiaInOrv3 = withOrv3([
      at("srv-x", "server", "rack-o", { type: "unit", u: 20 }, "srv-1u-compute"),
    ]);
    expect(errorsOf(eiaInOrv3)).toEqual(["W034@srv-x"]);
    const sledInEia = withChanges(sampleBlueprint(), {
      entities: [at("sled-x", "server", "rack-b", { type: "unit", u: 30 }, "orv3-cpu-1ou")],
      links: [link("power", "sled-x", "pdu-b")],
    });
    expect(errorsOf(sledInEia)).toEqual(["W034@sled-x"]);
  });

  test("a light rack's servers must match its rack as well", () => {
    const bp = withOrv3();
    const rack = bp.entities.find((x) => x.id === "rack-b") as Entity;
    const light = withChanges(bp, {
      entities: [
        {
          ...rack,
          props: { bulk: true, bulkServers: 4, bulkModel: "orv3-cpu-1ou", bulkUtil: 0.3 },
        },
      ],
      remove: ["srv-b1", "stor-b"],
    });
    expect(errorsOf(light)).toContain("W055@rack-b");
  });

  test("one OpenU is 48 mm and one U is 44.45 mm, so the same unit number stands higher in an ORv3 rack", () => {
    const bp = withOrv3();
    const index = new BlueprintIndex(bp);
    expect(rackStandardOf(index.entity("rack-o"), catalog)).toBe("orv3");
    expect(rackStandardOf(index.entity("rack-a"), catalog)).toBe("eia310");
    expect(unitHeightM(index.entity("rack-o"), catalog)).toBeCloseTo(0.048, 5);
    expect(unitHeightM(index.entity("rack-a"), catalog)).toBeCloseTo(0.04445, 5);
    const z = (id: string) => absolutePosition(index, catalog, id)?.z ?? 0;
    // A sled at OU10 is 1 OU tall: its middle is 9.5 OU up. A 2U server at U10 is 2 U tall: 10 U up.
    expect(z("sled-o1") - z("rack-o")).toBeCloseTo(9.5 * 0.048, 4);
    expect(z("srv-a1") - z("rack-a")).toBeCloseTo(10 * 0.04445, 4);
  });
});

describe("an ORv3 rack runs on its power shelf [REQ-063] [REQ-002]", () => {
  function boot() {
    const world = World.fromBlueprint(withOrv3(), catalog);
    const physics = new Physics(world);
    physics.settle();
    physics.run(300);
    return { world, physics, redfish: new RedfishFacade(world, new ProfileRegistry()) };
  }
  const req = (method: FacadeRequest["method"], path: string, body?: unknown): FacadeRequest => ({
    method,
    path,
    query: {},
    headers: {},
    body,
  });

  test("the sleds are powered through the shelf, which carries their load", () => {
    const { world } = boot();
    expect(world.stateAs("sled-o1", "server").powered).toBe(true);
    expect(world.stateAs("shelf-o", "pdu").loadW).toBeGreaterThan(300);
  });

  test("losing the shelf's breaker darkens every sled on the busbar", () => {
    const { world, physics } = boot();
    world.apply(
      {
        type: "fault.add",
        fault: { id: "t", type: "breaker_trip", target: "shelf-o", params: {} },
      },
      "test",
    );
    physics.run(30);
    expect(world.stateAs("sled-o1", "server").powered).toBe(false);
    expect(world.stateAs("sled-o2", "server").powered).toBe(false);
    expect(world.stateAs("tor-o", "switch").powered).toBe(false);
  });

  test("Redfish shows a PowerShelf under PowerShelves, with no outlets, and every resource conforms", () => {
    const { redfish } = boot();
    const shelf = redfish.handle(
      "shelf-o",
      req("GET", "/redfish/v1/PowerEquipment/PowerShelves/1"),
    );
    expect(shelf.status).toBe(200);
    expect(shelf.body).toMatchObject({ EquipmentType: "PowerShelf", Name: "shelf-o" });
    expect(shelf.body).not.toHaveProperty("Outlets");
    expect(schemaErrors(shelf.body)).toEqual([]);
    expect(
      redfish.handle("shelf-o", req("GET", "/redfish/v1/PowerEquipment/PowerShelves/1/Outlets"))
        .status,
    ).toBe(404);
    const result = crawl((path) => {
      const r = redfish.handle("shelf-o", req("GET", path));
      return { status: r.status, body: r.body };
    });
    expect(result.invalid).toEqual({});
    expect(result.broken).toEqual({});
  });

  test("a shelf has no outlets to switch", () => {
    const { world } = boot();
    expect(outletCount(world, "shelf-o")).toBe(0);
    expect(() =>
      world.apply({ type: "outlet.set", target: "shelf-o", outlet: 1, on: false }, "test"),
    ).toThrow(/no outlets/);
  });
});
