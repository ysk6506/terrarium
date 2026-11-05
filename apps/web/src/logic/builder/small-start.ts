/**
 * 작게 시작 (REQ-077, ADR-0083): not a bare field but a small site that already has the first three things — land,
 * a building, a server room — and nothing in the room yet. What is left to do is the part worth learning: fill the
 * room, then run it. The room is the smallest one the filler accepts, so it fills to 24 racks.
 */
import type { Catalog } from "@terrarium/core/catalog";
import { type Outline, outlineBounds } from "@terrarium/core/spatial";
import { type Blueprint, BlueprintIndex } from "@terrarium/core/world";
import { addRoom, EditError } from "./edit";
import { addBuilding } from "./edit-site";
import { MIN_FILL_M } from "./fill-plan";
import { newSite, rectangleOutline, type SiteSpec } from "./new-site";

/** The land a small start has when no shape is chosen: 300 × 200 m, with room to build beside the first building. */
export const SMALL_LAND_M = { w: 300, d: 200 } as const;
/** The first building: a data centre just big enough for the smallest server room. */
export const SMALL_BUILDING_M = { w: 30, d: 20 } as const;
const ROOM_AT_M = 3.6;

export type SmallSpec = Omit<SiteSpec, "outline" | "forSale"> & {
  readonly outline?: Outline;
  readonly forSale?: boolean;
};

/** Candidate corners for the first building, nearest the middle of the land first. */
function corners(outline: Outline): Array<{ x: number; y: number }> {
  const box = outlineBounds(outline);
  const cx = box.x + box.w / 2 - SMALL_BUILDING_M.w / 2;
  const cy = box.y + box.d / 2 - SMALL_BUILDING_M.d / 2;
  const out: Array<{ x: number; y: number }> = [];
  for (let j = -12; j <= 12; j++)
    for (let i = -12; i <= 12; i++)
      out.push({ x: Math.round((cx + i * 20) / 5) * 5, y: Math.round((cy + j * 20) / 5) * 5 });
  return out.sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy));
}

/** The small site: land (and any land for sale), one data-centre building, one empty server room on its first floor. */
export function smallStart(spec: SmallSpec, catalog: Catalog): Blueprint {
  const outline = spec.outline ?? rectangleOutline(SMALL_LAND_M.w, SMALL_LAND_M.d);
  const land = newSite({ ...spec, outline, forSale: spec.forSale ?? true });
  for (const at of corners(outline)) {
    let built: ReturnType<typeof addBuilding>;
    try {
      built = addBuilding(land, catalog, { ...at, ...SMALL_BUILDING_M }, "data_center");
    } catch (err) {
      if (err instanceof EditError) continue;
      throw err;
    }
    const index = new BlueprintIndex(built.blueprint);
    const floor = index.ofKind("floor")[0];
    if (!floor) break;
    const room = addRoom(
      built.blueprint,
      catalog,
      floor.id,
      { x: ROOM_AT_M, y: ROOM_AT_M, w: MIN_FILL_M.w, d: MIN_FILL_M.d },
      "data_hall",
    );
    return room.blueprint;
  }
  throw new EditError("이 땅에는 건물이 들어갈 자리가 없어요. 땅을 더 넓게 그려 주세요");
}
