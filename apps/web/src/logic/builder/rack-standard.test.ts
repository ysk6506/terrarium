import { Catalog } from "@terrarium/core/catalog";
import { BlueprintIndex, hasErrors, validateBlueprint } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import {
  addBuilding,
  addRoom,
  elevation,
  emptyWorld,
  mountDevice,
  placeRackRow,
  setModel,
} from ".";

const catalog = new Catalog();
const at = (x: number, y: number) => ({ x, y, rotation: 0 as const });

/** One room with an ORv3 rack and a 19-inch rack. */
function twoRacks() {
  let bp = emptyWorld("w", "규격 시험", { w: 200, d: 150 }, "평택사업장");
  bp = addBuilding(bp, catalog, { x: 10, y: 10, w: 40, d: 30 }).blueprint;
  const floor = new BlueprintIndex(bp).ofKind("floor")[0]?.id as string;
  bp = addRoom(bp, catalog, floor, { x: 1.2, y: 1.2, w: 18, d: 12 }).blueprint;
  const room = new BlueprintIndex(bp).ofKind("room")[0]?.id as string;
  const eia = placeRackRow(bp, catalog, room, at(2.4, 3.6), 1);
  bp = eia.blueprint;
  const second = placeRackRow(bp, catalog, room, at(5.4, 3.6), 1);
  const orv3 = second.select[0] as string;
  bp = setModel(second.blueprint, catalog, orv3, "orv3-48ou-std").blueprint;
  return { bp, eia: eia.select[0] as string, orv3 };
}

describe("racks of two standards in the builder [REQ-063] [REQ-006]", () => {
  test("a rack that changes standard takes its new height, and only while it is empty", () => {
    const { bp, eia, orv3 } = twoRacks();
    const index = new BlueprintIndex(bp);
    expect(index.entity(orv3).props.units).toBe(48);
    expect(index.entity(eia).props.units).toBe(42);
    const filled = mountDevice(bp, catalog, eia, "srv-1u-compute").blueprint;
    expect(() => setModel(filled, catalog, eia, "orv3-48ou-std")).toThrow(
      "EIA-310 19인치용이라 OCP ORv3 21인치 랙으로 바꿀 수 없어요",
    );
    const server = new BlueprintIndex(filled).childrenOf(eia)[0]?.id as string;
    expect(() => setModel(filled, catalog, server, "orv3-cpu-1ou")).toThrow(
      "OCP ORv3 21인치용이라 EIA-310 19인치 랙에는 달 수 없어요",
    );
  });

  test("a device built for the other standard is refused with the reason", () => {
    const { bp, eia, orv3 } = twoRacks();
    expect(() => mountDevice(bp, catalog, orv3, "srv-1u-compute")).toThrow(
      "EIA-310 19인치용이라 OCP ORv3 21인치 랙에는 달 수 없어요",
    );
    expect(() => mountDevice(bp, catalog, eia, "orv3-cpu-1ou")).toThrow(
      "OCP ORv3 21인치용이라 EIA-310 19인치 랙에는 달 수 없어요",
    );
  });

  test("sleds and a shelf mount in an ORv3 rack, and the shelf is what powers it", () => {
    const { bp, orv3 } = twoRacks();
    let next = mountDevice(bp, catalog, orv3, "orv3-shelf-18kw", 1).blueprint;
    next = mountDevice(next, catalog, orv3, "orv3-cpu-1ou").blueprint;
    next = mountDevice(next, catalog, orv3, "orv3-gpu-2ou").blueprint;
    const ev = elevation(new BlueprintIndex(next), catalog, orv3);
    expect(ev.units).toBe(48);
    expect(ev.supplyW).toBe(18_000);
    expect(ev.demandW).toBe(700 + 3200);
    expect(ev.pdus).toEqual([]);
    const names = new BlueprintIndex(next).childrenOf(orv3).map((d) => d.name);
    expect(names).toContain("파워 셸프 1");
    expect(hasErrors(validateBlueprint(next, catalog).filter((i) => i.code === "W034"))).toBe(
      false,
    );
  });
});
