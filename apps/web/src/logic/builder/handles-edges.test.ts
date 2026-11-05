import { type Blueprint, BlueprintIndex, type Entity } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { draggedRect, handleAt, handleSize, handlesFit } from "./handles";
import type { Level } from "./levels";

const e = (
  id: string,
  kind: Entity["kind"],
  parentId: string | undefined,
  extra: Partial<Entity> = {},
): Entity => ({
  id,
  kind,
  name: id,
  props: {},
  ...(parentId ? { parentId } : {}),
  ...extra,
});
const site = e("site", "site", undefined, { placement: { type: "land", w: 100, d: 100 } });
const bldg = e("bldg", "building", "site", {
  placement: { type: "area", x: 0, y: 0, w: 40, d: 20 },
});
const locked = e("locked", "building", "site", {
  placement: { type: "area", x: 50, y: 0, w: 40, d: 20 },
  props: { sizeLocked: true },
});
const floor = e("fl", "floor", "bldg", { placement: { type: "level", level: 1, height: 4 } });
const hall = e("hall", "room", "fl", { placement: { type: "area", x: 2, y: 2, w: 10, d: 6 } });
const world = new BlueprintIndex({
  schemaVersion: 1,
  id: "b",
  name: "b",
  entities: [site, bldg, locked, floor, hall],
  links: [],
  meta: {},
} as Blueprint);

const SITE: Level = { kind: "site" };

describe("where the handles of a room or building can be shown [REQ-075] [REQ-076]", () => {
  test("a room has handles on its own floor and inside itself, and nowhere else", () => {
    expect(handlesFit(world, { kind: "floor", id: "fl" }, hall)).toBe(true);
    expect(handlesFit(world, { kind: "room", id: "hall" }, hall)).toBe(true);
    expect(handlesFit(world, { kind: "floor", id: "other" }, hall)).toBe(false);
    expect(handlesFit(world, { kind: "room", id: "other" }, hall)).toBe(false);
    expect(handlesFit(world, SITE, hall)).toBe(false);
  });

  test("a building has handles on the site and inside itself, unless its size is real", () => {
    expect(handlesFit(world, SITE, bldg)).toBe(true);
    expect(handlesFit(world, { kind: "floor", id: "fl" }, bldg)).toBe(true);
    expect(handlesFit(world, { kind: "floor", id: "fl" }, locked)).toBe(false);
    expect(handlesFit(world, SITE, locked)).toBe(false);
    expect(handlesFit(world, { kind: "room", id: "hall" }, bldg)).toBe(false);
  });

  test("things with no area, or of another kind, have none", () => {
    expect(handlesFit(world, SITE, undefined)).toBe(false);
    expect(handlesFit(world, SITE, floor)).toBe(false);
    expect(
      handlesFit(
        world,
        SITE,
        e("rack", "rack", "hall", { placement: { type: "spot", x: 1, y: 1, rotation: 0 } }),
      ),
    ).toBe(false);
  });

  test("a handle is a hand's width for a room and more for a building", () => {
    expect(handleSize(bldg)).toBeGreaterThan(handleSize(hall));
  });
});

describe("dragging a side of a rectangle [REQ-075]", () => {
  const r = { x: 10, y: 10, w: 20, d: 10 };

  test("each side moves only itself, to the grid", () => {
    expect(draggedRect(r, "left", -3, 0, 1)).toEqual({ x: 7, y: 10, w: 23, d: 10 });
    expect(draggedRect(r, "right", 4, 0, 1)).toEqual({ x: 10, y: 10, w: 24, d: 10 });
    expect(draggedRect(r, "top", 0, -2, 1)).toEqual({ x: 10, y: 8, w: 20, d: 12 });
    expect(draggedRect(r, "bottom", 0, 5, 1)).toEqual({ x: 10, y: 10, w: 20, d: 15 });
  });

  test("a side dragged past the other one stops one grid step short of it", () => {
    expect(draggedRect(r, "left", 50, 0, 1)).toMatchObject({ x: 29, w: 1 });
    expect(draggedRect(r, "right", -50, 0, 1)).toMatchObject({ x: 10, w: 1 });
    expect(draggedRect(r, "top", 0, 50, 1)).toMatchObject({ y: 19, d: 1 });
    expect(draggedRect(r, "bottom", 0, -50, 1)).toMatchObject({ y: 10, d: 1 });
  });

  test("the handle nearest the pointer within reach is the one grabbed", () => {
    const handles = [
      { kind: "edge", side: "left", at: { x: 0, y: 0 } },
      { kind: "edge", side: "right", at: { x: 10, y: 0 } },
    ] as never;
    expect((handleAt(handles, { x: 9.5, y: 0.2 }, 1) as { side: string }).side).toBe("right");
    expect(handleAt(handles, { x: 5, y: 5 }, 1)).toBeUndefined();
  });
});
