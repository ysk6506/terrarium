import { Catalog } from "@terrarium/core/catalog";
import { describe, expect, test } from "vitest";
import { BlueprintIndex, buildingFloorSpaces, designDrawW, emptyBlueprint, siteDrawW } from ".";

const catalog = new Catalog();

describe("odd corners of the floor and power counts [REQ-076]", () => {
  test("a floor with no level still has its numbers, listed first, and a machine standing in no building is on the connection", () => {
    const model = catalog.list("server")[0]?.id as string;
    const server = {
      id: "loose",
      kind: "server" as const,
      name: "서버",
      modelId: model,
      props: {},
    };
    const bp = {
      ...emptyBlueprint("w", "시험"),
      entities: [
        {
          id: "s",
          kind: "site" as const,
          name: "사업장",
          placement: { type: "land" as const, w: 100, d: 100 },
          props: {},
        },
        {
          id: "b",
          kind: "building" as const,
          name: "건물",
          parentId: "s",
          placement: { type: "area" as const, x: 0, y: 0, w: 20, d: 20 },
          props: {},
        },
        { id: "bare", kind: "floor" as const, name: "층", parentId: "b", props: {} },
        {
          id: "f2",
          kind: "floor" as const,
          name: "2층",
          parentId: "b",
          placement: { type: "level" as const, level: 2, height: 4.5 },
          props: {},
        },
        server,
      ],
    };
    const index = new BlueprintIndex(bp);
    expect(buildingFloorSpaces(index, catalog, "b").map((f) => f.floorId)).toEqual(["bare", "f2"]);
    expect(siteDrawW(index, catalog)).toBeCloseTo(designDrawW(server, catalog), 6);
  });
});
