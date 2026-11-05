/** Checks on the shape of a room made of pieces (REQ-075, ADR-0080). */
import type { Catalog } from "@terrarium/core/catalog";
import { withJosa } from "@terrarium/core/kernel";
import { contains } from "@terrarium/core/spatial";
import { footprint } from "./geometry";
import type { BlueprintIndex } from "./graph";
import { roomRects, shapeProblem } from "./room-shape";
import type { Issue } from "./validate";

const error = (message: string, fix: string, entityId: string): Issue => ({
  severity: "error",
  code: "W056",
  message,
  fix,
  entityId,
});

const SHAPE_MESSAGES = {
  empty: ["조각 크기가 0 이하예요", "조각의 폭과 깊이를 양수로 정해요."],
  overlap: ["조각이 다른 조각과 겹쳐요", "겹치지 않게 조각을 옮기거나 떼어요."],
  detached: ["조각이 방에 붙어 있지 않아요", "변이 맞닿게 붙이거나 조각을 떼어요."],
  hole: ["조각이 빈 자리를 둘러싸요", "빈 자리가 생기지 않게 붙여요."],
} as const;

/** Every piece of a room must touch the rest along an edge, not overlap it, and stand inside the building. */
export function checkRoomShapes(index: BlueprintIndex, catalog: Catalog): Issue[] {
  const out: Issue[] = [];
  for (const room of index.ofKind("room")) {
    if (room.placement?.type !== "area" || !room.placement.pieces?.length) continue;
    const rects = roomRects(room);
    const problem = shapeProblem(rects);
    if (problem) {
      const [what, fix] = SHAPE_MESSAGES[problem.kind];
      out.push(error(`${room.name}의 ${what}`, fix, room.id));
    }
    const floor = room.parentId ? index.find(room.parentId) : undefined;
    const building = floor ? index.enclosing(floor.id, "building") : undefined;
    const box = building ? footprint(building, catalog) : undefined;
    if (box && rects.some((r) => !contains({ x: 0, y: 0, w: box.w, d: box.d }, r)))
      out.push(
        error(
          `${withJosa(room.name, "이")} 건물 바닥 밖으로 나가요`,
          "조각을 안쪽으로 옮기거나 건물을 넓혀요.",
          room.id,
        ),
      );
  }
  return out;
}
