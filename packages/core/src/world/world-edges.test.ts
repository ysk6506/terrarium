import { Catalog } from "@terrarium/core/catalog";
import { NotFoundError } from "@terrarium/core/kernel";
import { describe, expect, test } from "vitest";
import {
  ENTITY_KINDS,
  type Entity,
  isVirtualKind,
  ROOM_PURPOSES,
  roomPurposeOf,
  validateBlueprint,
  World,
} from ".";
import { sampleBlueprint, withChanges } from "./test-support/sample";

const catalog = new Catalog();
const room = (props: Entity["props"]): Entity => ({
  id: "r",
  kind: "room",
  name: "r",
  parentId: "floor",
  placement: { type: "area", x: 0, y: 0, w: 10, d: 10 },
  props,
});

describe("lookups and labels at the edges [REQ-001]", () => {
  test("a room is a data hall unless it says otherwise, and an unknown purpose counts as unset", () => {
    expect(roomPurposeOf(room({}))).toBe("data_hall");
    expect(roomPurposeOf(room({ purpose: "cafeteria" }))).toBe("data_hall");
    for (const purpose of ROOM_PURPOSES) expect(roomPurposeOf(room({ purpose }))).toBe(purpose);
  });

  test("only the four virtual kinds are virtual", () => {
    const virtual = ENTITY_KINDS.filter(isVirtualKind);
    expect(virtual).toEqual(["vcenter", "cluster", "vm", "datastore"]);
  });

  test("the index answers by id and says plainly what it does not know", () => {
    const { index } = World.fromBlueprint(sampleBlueprint(), catalog);
    const anyEntity = sampleBlueprint().entities[0] as Entity;
    const anyLink = sampleBlueprint().links[0];
    expect(index.has(anyEntity.id)).toBe(true);
    expect(index.has("nope")).toBe(false);
    expect(index.find(anyEntity.id)?.id).toBe(anyEntity.id);
    expect(index.find("nope")).toBeUndefined();
    expect(index.entity(anyEntity.id).id).toBe(anyEntity.id);
    expect(() => index.entity("nope")).toThrow(NotFoundError);
    expect(index.link(anyLink?.id as string).id).toBe(anyLink?.id);
    expect(() => index.link("nope")).toThrow(NotFoundError);
  });

  test("a site cannot be put inside a room, and the message says it has no parent", () => {
    const bp = sampleBlueprint();
    const stray: Entity = {
      id: "stray-site",
      kind: "site",
      name: "stray",
      parentId: "hall",
      placement: { type: "area", x: 0, y: 0, w: 5, d: 5 },
      props: {},
    };
    const issues = validateBlueprint(withChanges(bp, { entities: [stray] }), catalog);
    const w004 = issues.find((i) => i.code === "W004" && i.entityId === "stray-site");
    expect(w004?.fix).toContain("상위 공간 없이");
  });
});
