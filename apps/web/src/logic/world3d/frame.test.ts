import { Catalog } from "@terrarium/core/catalog";
import { DEFAULT_CAMPUS, generateCampus } from "@terrarium/core/sources/worldgen";
import { BlueprintIndex, type Entity, roomPurposeOf } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { sceneOf } from "../builder/scene";
import { focusBox } from "./camera";
import { focusOfLevel, planFrame, toPlan, toSite } from "./frame";
import { ROOM_HEIGHT_M } from "./room";
import { ghostBox, outlinesOf } from "./select";
import { type SiteScene, siteScene } from "./site";

const catalog = new Catalog();
const bp = generateCampus(
  {
    ...DEFAULT_CAMPUS,
    site: "pyeongtaek",
    seed: 7,
    buildings: 2,
    floors: 2,
    hallsPerFloor: 2,
    podsPerHall: 4,
    detail: 0.5,
  },
  catalog,
).blueprint;
const index = new BlueprintIndex(bp);
const site = siteScene(index, catalog) as SiteScene;
const hall = index.ofKind("room").find((r) => roomPurposeOf(r) === "data_hall") as Entity;
const floor = index.enclosing(hall.id, "floor") as Entity;
const building = index.enclosing(hall.id, "building") as Entity;
const info = site.buildings.find((b) => b.id === building.id) as SiteScene["buildings"][number];

/** The same site with the building turned, as a campus laid out on a slant would have it. */
const turned = (rot: number): SiteScene => ({
  ...site,
  buildings: site.buildings.map((b) => (b.id === building.id ? { ...b, rot } : b)),
});

describe("where a level's plan stands in the site [REQ-006]", () => {
  test("the site's plan is the site itself", () => {
    const frame = planFrame(index, catalog, site, { kind: "site" });
    expect(frame).toEqual({ x: 0, y: 0, z: 0, rot: 0 });
    expect(toSite(frame as NonNullable<typeof frame>, { x: 12, y: 30 })).toEqual({ x: 12, z: 30 });
  });

  test("a floor's plan starts at the building's corner, at the height of that floor", () => {
    const frame = planFrame(index, catalog, site, { kind: "floor", id: floor.id });
    if (!frame) throw new Error("no frame");
    expect(frame.x).toBeCloseTo(info.x - info.w / 2);
    expect(frame.z).toBeCloseTo(info.z - info.d / 2);
    expect(frame.y).toBeCloseTo(4.5);
    expect(frame.rot).toBe(info.rot);
  });

  test("the middle of a floor's plan is the middle of the building, however it is turned", () => {
    for (const rot of [0, 0.7, -2.1]) {
      const frame = planFrame(index, catalog, turned(rot), { kind: "floor", id: floor.id });
      const middle = toSite(frame as NonNullable<typeof frame>, { x: info.w / 2, y: info.d / 2 });
      expect(middle.x).toBeCloseTo(info.x);
      expect(middle.z).toBeCloseTo(info.z);
    }
  });

  test("a room's plan starts at the room's corner, a raised floor above its slab", () => {
    const frame = planFrame(index, catalog, site, { kind: "room", id: hall.id });
    const box = focusBox(index, catalog, site, { kind: "room", id: hall.id });
    if (!frame || !box) throw new Error("no frame");
    expect(frame.x).toBeCloseTo(box.x0);
    expect(frame.z).toBeCloseTo(box.z0);
    expect(frame.y).toBeCloseTo(box.y0 + 0.6);
  });

  test("a point goes to the site and back to the same place", () => {
    for (const rot of [0, 0.7, 3]) {
      const frame = planFrame(index, catalog, turned(rot), { kind: "room", id: hall.id });
      for (const p of [
        { x: 0, y: 0 },
        { x: 5, y: 2.5 },
        { x: -3, y: 40 },
      ]) {
        const back = toPlan(
          frame as NonNullable<typeof frame>,
          toSite(frame as NonNullable<typeof frame>, p),
        );
        expect(back.x).toBeCloseTo(p.x);
        expect(back.y).toBeCloseTo(p.y);
      }
    }
  });

  test("a turn of a quarter moves plan x toward the site's -z, as three.js turns things", () => {
    const frame = { x: 10, y: 0, z: 10, rot: Math.PI / 2 };
    const p = toSite(frame, { x: 4, y: 0 });
    expect(p.x).toBeCloseTo(10);
    expect(p.z).toBeCloseTo(6);
  });

  test("a level that is not in the world has no frame", () => {
    expect(planFrame(index, catalog, site, { kind: "room", id: "nope" })).toBeUndefined();
    expect(planFrame(index, catalog, site, { kind: "floor", id: "nope" })).toBeUndefined();
  });

  test("each level is looked at as the matching focus", () => {
    expect(focusOfLevel({ kind: "site" })).toEqual({ kind: "site" });
    expect(focusOfLevel({ kind: "floor", id: "f" })).toEqual({ kind: "floor", id: "f" });
    expect(focusOfLevel({ kind: "room", id: "r" })).toEqual({ kind: "room", id: "r" });
  });
});

describe("what is drawn over the picture while building [REQ-006]", () => {
  const scene = sceneOf(index, catalog, { kind: "room", id: hall.id });

  test("a selected rack is outlined where the plan draws it", () => {
    const rack = scene.groups.find((g) => g.key === "rack");
    const id = rack?.ids[0] as string;
    const [box] = outlinesOf(scene, [id]);
    expect(box).toBeDefined();
    const at = scene.where.get(id) as { index: number };
    const b = rack?.boxes as Float32Array;
    expect(box?.x).toBeCloseTo(b[at.index * 6] as number);
    expect(box?.z).toBeCloseTo(b[at.index * 6 + 2] as number);
    expect(box?.y).toBeCloseTo((box?.h ?? 0) / 2);
  });

  test("a room is outlined as high as its walls, and what is not on the level is left out", () => {
    const floorScene = sceneOf(index, catalog, { kind: "floor", id: floor.id });
    const [room] = outlinesOf(floorScene, [hall.id]);
    expect(room?.h).toBe(ROOM_HEIGHT_M);
    expect(outlinesOf(floorScene, ["nope", hall.id])).toHaveLength(1);
    expect(outlinesOf(floorScene, [])).toEqual([]);
  });

  test("the ghost of a placement is a box standing on the plan from its corner", () => {
    const box = ghostBox({ x: 2, y: 4, w: 2, d: 6, h: 3, ok: true });
    expect(box).toEqual({ x: 3, y: 1.5, z: 7, w: 2, h: 3, d: 6 });
  });
});
