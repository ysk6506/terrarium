import { Catalog } from "@terrarium/core/catalog";
import { World } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { sampleBlueprint } from "../world/test-support/sample";
import { Physics } from ".";
import { capacityW, drawW, SupplyResolver } from "./power";

function boot() {
  const world = World.fromBlueprint(sampleBlueprint(), new Catalog());
  const engine = new Physics(world);
  engine.settle();
  return world;
}

describe("who is fed, and over which cables [REQ-107]", () => {
  test("[REQ-107] a server is fed through its PDU, panel and UPS, and the active feed is the PDU", () => {
    const world = boot();
    const supply = new SupplyResolver(world);
    expect(supply.fed("srv-a1")).toBe(true);
    expect(supply.delivers("pdu-a")).toBe(true);
    expect(supply.delivers("panel-1")).toBe(true);
    expect(supply.activeFeeds("srv-a1")).toEqual(["pdu-a"]);
    expect(supply.activeFeeds("panel-1")).toEqual(["ups-1"]);
  });

  test("[REQ-107] a tripped PDU stops delivering and the server behind it is no longer fed", () => {
    const world = boot();
    world.stateAs("pdu-a", "pdu").tripped = true;
    const supply = new SupplyResolver(world);
    expect(supply.delivers("pdu-a")).toBe(false);
    expect(supply.fed("srv-a1")).toBe(false);
    expect(supply.activeFeeds("srv-a1")).toEqual([]);
    expect(supply.fed("srv-b1")).toBe(true);
  });

  test("[REQ-107] a thing that is not a supplier does not deliver", () => {
    const world = boot();
    const supply = new SupplyResolver(world);
    expect(supply.delivers("srv-a1")).toBe(false);
  });

  test("[REQ-107] a breaker has a capacity, and a PDU, a panel and a thing that draws nothing report what they carry", () => {
    const world = boot();
    expect(capacityW(world, "pdu-a")).toBeGreaterThan(1000);
    expect(drawW(world, "pdu-a")).toBe(world.stateAs("pdu-a", "pdu").loadW);
    expect(drawW(world, "panel-1")).toBe(world.stateAs("panel-1", "power_panel").loadW);
    expect(drawW(world, "vc")).toBe(0);
  });
});
