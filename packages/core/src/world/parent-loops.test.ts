import { Catalog } from "@terrarium/core/catalog";
import { describe, expect, test } from "vitest";
import { type Blueprint, BlueprintIndex, validateBlueprint } from ".";
import { sampleBlueprint } from "./test-support/sample";

const catalog = new Catalog();

/** The sample hall with its floor placed under its own room: parents that go round in a circle. */
function looped(): Blueprint {
  const bp = sampleBlueprint();
  const room = bp.entities.find((e) => e.kind === "room");
  if (!room) throw new Error("the sample has a room");
  return {
    ...bp,
    entities: bp.entities.map((e) => (e.kind === "floor" ? { ...e, parentId: room.id } : e)),
  };
}

describe("parents that go round in a circle [REQ-035]", () => {
  test("the index can still be walked: nothing below an entity repeats", () => {
    const index = new BlueprintIndex(looped());
    for (const entity of index.all()) {
      const ids = index.descendants(entity.id).map((e) => e.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  test("validation says which entities loop and how to fix it, instead of running out of memory", () => {
    const issues = validateBlueprint(looped(), catalog);
    const loops = issues.filter((i) => i.code === "W012");
    expect(loops.length).toBeGreaterThanOrEqual(2);
    for (const issue of loops) {
      expect(issue.severity).toBe("error");
      expect(issue.fix).toMatch(/한 방향/);
    }
  });

  test("a healthy blueprint has no loop", () => {
    const index = new BlueprintIndex(sampleBlueprint());
    expect(index.all().some((e) => index.inParentLoop(e.id))).toBe(false);
    expect(validateBlueprint(sampleBlueprint(), catalog).some((i) => i.code === "W012")).toBe(
      false,
    );
  });
});
