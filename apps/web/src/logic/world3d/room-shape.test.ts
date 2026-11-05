import { Catalog } from "@terrarium/core/catalog";
import { BlueprintIndex } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { addBuilding, addPiece, addRoom, emptyWorld, placeRackRow } from "../builder";
import { workBounds } from "./airflow";
import { fieldAt, fieldOf } from "./airflow-field";
import { buildingScene } from "./building";
import { focusBox } from "./camera";
import {
  backWall,
  boundsOfScene,
  insetOutline,
  insideScene,
  outlineOfScene,
  rectsOfScene,
  roomScene,
} from "./room";
import { siteScene } from "./site";

const catalog = new Catalog();

/** A 12 x 9 m room in a building with a 6 x 4.8 m piece to its right and a 3 x 3 m piece above it on the left. */
function world() {
  let bp = emptyWorld("w", "시험", { w: 200, d: 150 }, "사업장");
  bp = addBuilding(bp, catalog, { x: 10, y: 10, w: 40, d: 30 }).blueprint;
  const floorId = new BlueprintIndex(bp).ofKind("floor")[0]?.id as string;
  bp = addRoom(bp, catalog, floorId, { x: 6, y: 6, w: 12, d: 9 }).blueprint;
  const roomId = new BlueprintIndex(bp).ofKind("room")[0]?.id as string;
  bp = placeRackRow(bp, catalog, roomId, { x: 1.2, y: 1.2, rotation: 0 }, 3).blueprint;
  const plain = new BlueprintIndex(bp);
  bp = addPiece(bp, catalog, roomId, "right", { along: 4.8, out: 6 }).blueprint;
  bp = addPiece(bp, catalog, roomId, "left", { along: 3, out: 3 }).blueprint;
  return { plain, index: new BlueprintIndex(bp), roomId };
}

describe("a room made of pieces in the 3D scenes [REQ-075]", () => {
  test("the room scene keeps the body as w and d and adds the rectangles, the outline and the box round them", () => {
    const { index, roomId, plain } = world();
    const scene = roomScene(index, catalog, roomId);
    expect(scene).toBeDefined();
    if (!scene) return;
    expect([scene.w, scene.d]).toEqual([12, 9]);
    expect(rectsOfScene(scene)).toHaveLength(3);
    expect(scene.rects).toContainEqual({ x0: -3, z0: 0, x1: 0, z1: 3 });
    expect(scene.rects).toContainEqual({ x0: 12, z0: 0, x1: 18, z1: 4.8 });
    expect(boundsOfScene(scene)).toEqual({ x0: -3, z0: 0, x1: 18, z1: 9 });
    expect(outlineOfScene(scene).length).toBe(8);
    expect(insideScene(scene, 15, 2)).toBe(true);
    expect(insideScene(scene, 15, 7)).toBe(false);
    expect(insideScene(scene, -2, 2)).toBe(true);
    expect(insideScene(scene, -2, 5)).toBe(false);
    const flat = roomScene(plain, catalog, roomId);
    expect(flat && rectsOfScene(flat)).toEqual([{ x0: 0, z0: 0, x1: 12, z1: 9 }]);
  });

  test("the back wall for the sprinkler is the longest stretch on the top line", () => {
    const { index, roomId } = world();
    const scene = roomScene(index, catalog, roomId);
    expect(scene && backWall(scene)).toEqual({ x0: -3, x1: 18, z: 0 });
  });

  test("the heat floor covers the box round the room, its coordinates start where the box does, and it ends short of the walls along the outline", () => {
    const { index, roomId } = world();
    const scene = roomScene(index, catalog, roomId);
    if (!scene) throw new Error("no scene");
    const field = fieldOf(scene, [], [], 24, "inlet");
    expect(field.x0).toBe(-3);
    expect(field.z0).toBe(0);
    expect(field.w).toBe(21);
    expect(field.d).toBe(9);
    expect(Number.isFinite(fieldAt(field, -2, 2))).toBe(true);
    expect(Number.isFinite(fieldAt(field, 17, 4))).toBe(true);
    const inset = insetOutline(outlineOfScene(scene), 0.15);
    expect(inset).toHaveLength(8);
    // every corner moved inward: the inset area is smaller than the room's by the margin round its perimeter
    const area = (poly: ReadonlyArray<{ x: number; z: number }>) =>
      poly.reduce((sum, p, i) => {
        const q = poly[(i + 1) % poly.length] as { x: number; z: number };
        return sum + (p.x * q.z - q.x * p.z) / 2;
      }, 0);
    expect(area(outlineOfScene(scene))).toBeCloseTo(12 * 9 + 6 * 4.8 + 9, 9);
    expect(area(inset)).toBeLessThan(area(outlineOfScene(scene)));
    expect(area(inset)).toBeGreaterThan(area(outlineOfScene(scene)) - 0.15 * 2 * 60);
    for (const p of inset) expect(insideScene(scene, p.x, p.z)).toBe(true);
  });

  test("a plain room's heat floor starts at zero, as before", () => {
    const { plain, roomId } = world();
    const scene = roomScene(plain, catalog, roomId);
    if (!scene) throw new Error("no scene");
    const field = fieldOf(scene, [], [], 24, "inlet");
    expect([field.x0, field.z0, field.w, field.d]).toEqual([0, 0, 12, 9]);
  });

  test("the map's work area stays inside the whole floor, and the camera looks at all of it", () => {
    const { index, roomId } = world();
    const scene = roomScene(index, catalog, roomId);
    if (!scene) throw new Error("no scene");
    const air = { racks: [{ x: -2, z: 1, w: 0.6, d: 1.2 }], units: [] } as never;
    const bounds = workBounds(scene, air, 50);
    expect(bounds).toEqual({ x0: -3, z0: 0, x1: 18, z1: 9 });
    const box = focusBox(index, catalog, siteScene(index, catalog) as never, {
      kind: "room",
      id: roomId,
    });
    expect(box && box.x1 - box.x0).toBe(21);
  });

  test("the building scene draws the room with its pieces", () => {
    const { index, roomId } = world();
    const building = index.ofKind("building")[0]?.id as string;
    const scene = buildingScene(index, catalog, building);
    const room = scene?.floors[0]?.rooms.find((r) => r.id === roomId);
    expect(room?.x).toBe(6);
    expect(room && rectsOfScene(room.scene)).toHaveLength(3);
  });
});
