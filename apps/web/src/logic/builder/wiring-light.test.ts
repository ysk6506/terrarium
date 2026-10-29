import { bulkProps, type Entity } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { linkKindsFrom } from "./wiring";

const rack = (props: Entity["props"]): Entity => ({
  id: "r1",
  kind: "rack",
  name: "r1",
  parentId: "pod",
  modelId: "rack-42u",
  placement: { type: "spot", x: 0, y: 0, rotation: 0 },
  props,
});

describe("cables on a light rack [REQ-049] [REQ-006]", () => {
  test("only a light rack starts a power cable itself; an ordinary rack is fed through its devices", () => {
    const light = rack(
      bulkProps({ servers: 10, modelId: "srv-1u-web", util: 0.4, overheadW: 120 }),
    );
    expect(linkKindsFrom("rack")).toEqual(["cooling"]);
    expect(linkKindsFrom("rack", rack({}))).toEqual(["cooling"]);
    expect(linkKindsFrom("rack", light).sort()).toEqual(["cooling", "power"]);
  });
});
