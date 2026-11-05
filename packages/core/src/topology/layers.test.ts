import { Catalog } from "@terrarium/core/catalog";
import { World } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { sampleBlueprint, withChanges } from "../world/test-support/sample";
import { campusBlueprint } from "../world/test-support/sample-campus";
import { chainOf, type LayerShape, layerShape } from "./layers";
import { LAYER_IDS } from "./types";

const catalog = new Catalog();
const sample = World.fromBlueprint(sampleBlueprint(), catalog);
const campus = World.fromBlueprint(campusBlueprint(), catalog);

const labels = (shape: LayerShape) => shape.stages.map((s) => s.label);
const stageIds = (shape: LayerShape, stage: number) => [...(shape.members[stage] ?? [])].sort();

describe("the layers of a world are cut into stages that read from the source to the servers [REQ-078]", () => {
  test("the power layer of the sample hall: UPS, panel, PDU, rack, server", () => {
    const shape = layerShape(sample.index, "power");
    expect(labels(shape)).toEqual(["UPS", "분전반", "PDU", "랙", "서버"]);
    expect(stageIds(shape, 0)).toEqual(["ups-1"]);
    expect(stageIds(shape, 1)).toEqual(["panel-1"]);
    expect(shape.consumers.get("panel-1")).toEqual(expect.arrayContaining(["pdu-a", "pdu-b"]));
    expect(shape.consumers.get("pdu-a")).toEqual(["rack-a"]);
    expect(shape.consumers.get("rack-a")).toEqual(expect.arrayContaining(["srv-a1", "srv-a2"]));
  });

  test("a campus adds the transfer switch and the generator in front of the UPS", () => {
    const shape = layerShape(campus.index, "power");
    expect(labels(shape)[0]).toBe("변압기·발전기");
    expect(shape.kindOf.get("gen-1")).toBe("generator");
    expect(shape.kindOf.get("ats-1")).toBe("feed");
    expect(shape.consumers.get("ats-1")).toContain("ups-2");
  });

  test("the cooling layer: units, then the room they blow into, then its racks, then servers", () => {
    const shape = layerShape(sample.index, "cooling");
    expect(labels(shape)).toEqual(["냉방기", "서버룸", "랙", "서버"]);
    expect(shape.consumers.get("crah-1")).toEqual(["hall"]);
    expect(shape.consumers.get("crah-2")).toEqual(["hall"]);
    expect(stageIds(shape, 2)).toEqual(["rack-a", "rack-b"]);
    expect(shape.suppliers.get("rack-b")).toEqual(["hall"]);
  });

  test("a plant stage and a liquid rack on a CDU show up when the world has them", () => {
    const shape = layerShape(campus.index, "cooling");
    expect(labels(shape)[0]).toBe("냉각 플랜트");
    expect(shape.kindOf.get("chiller-1")).toBe("chiller");
    expect(shape.kindOf.get("cdu-1")).toBe("cdu");
    expect(shape.consumers.get("cdu-1")).toContain("rack-l");
    expect(shape.consumers.get("chiller-1")).toContain("cdu-1");
  });

  test("the network layer ends at the servers, and goes on to VMs and clusters when there are some", () => {
    const shape = layerShape(sample.index, "network");
    expect(labels(shape)).toEqual(["ToR 스위치", "서버·스토리지", "VM·클러스터"]);
    expect(shape.consumers.get("tor-a")).toEqual(expect.arrayContaining(["srv-a1", "stor-b"]));
    expect(shape.consumers.get("srv-a1")).toEqual(expect.arrayContaining(["vm-web", "cl1"]));
    const bare = World.fromBlueprint(
      withChanges(sampleBlueprint(), { remove: ["vm-web", "vm-db", "cl1"] }),
      catalog,
    );
    expect(labels(layerShape(bare.index, "network"))).toEqual(["ToR 스위치", "서버·스토리지"]);
  });

  test("every pipe goes from an earlier stage to a later one, in every layer", () => {
    for (const world of [sample, campus])
      for (const layer of LAYER_IDS) {
        const shape = layerShape(world.index, layer);
        for (const [from, list] of shape.consumers)
          for (const to of list)
            expect(shape.stageOf.get(from) as number).toBeLessThan(shape.stageOf.get(to) as number);
      }
  });

  test("the suppliers are the consumers read backwards", () => {
    for (const layer of LAYER_IDS) {
      const shape = layerShape(campus.index, layer);
      for (const [from, list] of shape.consumers)
        for (const to of list) expect(shape.suppliers.get(to)).toContain(from);
    }
  });

  test("a shape is made once for a blueprint", () => {
    expect(layerShape(sample.index, "power")).toBe(layerShape(sample.index, "power"));
    const again = World.fromBlueprint(sampleBlueprint(), catalog);
    expect(layerShape(again.index, "power")).not.toBe(layerShape(sample.index, "power"));
  });

  test("a container chain runs from the site down, and a VM stands where its host does", () => {
    expect(chainOf(sample.index, "rack-a")).toEqual(["site", "bldg", "fl1", "hall", "ca1"]);
    expect(chainOf(sample.index, "srv-a1").at(-1)).toBe("rack-a");
    expect(chainOf(sample.index, "vm-web")).toEqual([...chainOf(sample.index, "srv-a1"), "srv-a1"]);
    expect(chainOf(sample.index, "site")).toEqual([]);
  });

  test("a layer leaves out a stage that has nothing in it", () => {
    const noUnits = World.fromBlueprint(
      withChanges(sampleBlueprint(), { remove: ["crah-1", "crah-2"] }),
      catalog,
    );
    const shape = layerShape(noUnits.index, "cooling");
    expect(labels(shape)).toEqual(["서버룸", "랙", "서버"]);
    for (const members of shape.members) expect(members.length).toBeGreaterThan(0);
  });
});
