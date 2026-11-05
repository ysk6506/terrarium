/**
 * Checks that only make sense once a world has land, liquid cooling and a plant (REQ-043, REQ-044):
 * parcels, buildings on owned land, which servers fit which racks, and loops that lead nowhere.
 */
import type { Catalog } from "@terrarium/core/catalog";
import { withJosa } from "@terrarium/core/kernel";
import {
  contains,
  type Outline,
  overlaps,
  parseOutline,
  pointInOutline,
  type Rect,
} from "@terrarium/core/spatial";
import type { Entity } from "./blueprint";
import { footprint } from "./geometry";
import type { BlueprintIndex } from "./graph";
import type { Issue } from "./validate";

const error = (code: string, message: string, fix: string, entityId: string): Issue => ({
  severity: "error",
  code,
  message,
  fix,
  entityId,
});
const warning = (code: string, message: string, fix: string, entityId: string): Issue => ({
  severity: "warning",
  code,
  message,
  fix,
  entityId,
});

/** Whether a parcel belongs to the site's owner (parcels are owned unless marked for sale). */
export const isOwned = (parcel: Entity): boolean => parcel.props.owned !== false;

function rectOf(entity: Entity, catalog: Catalog): Rect | undefined {
  return footprint(entity, catalog);
}

/** Parcels must not overlap each other, and buildings must stand on land the owner has. */
export function checkParcels(index: BlueprintIndex, catalog: Catalog): Issue[] {
  const out: Issue[] = [];
  for (const site of index.ofKind("site")) {
    const parcels = index.childrenOf(site.id, "parcel");
    for (let i = 0; i < parcels.length; i++)
      for (let j = i + 1; j < parcels.length; j++) {
        const a = rectOf(parcels[i] as Entity, catalog);
        const b = rectOf(parcels[j] as Entity, catalog);
        if (a && b && overlaps(a, b))
          out.push(
            error(
              "W040",
              `${withJosa((parcels[i] as Entity).name, "과")} ${withJosa((parcels[j] as Entity).name, "이")} 겹쳐요`,
              "부지를 겹치지 않게 나눠요.",
              (parcels[j] as Entity).id,
            ),
          );
      }
    const owned = parcels.filter(isOwned).flatMap((p) => rectOf(p, catalog) ?? []);
    const outline = parseOutline(site.props.outline);
    if (parcels.length === 0 && !outline) continue;
    for (const building of index.childrenOf(site.id, "building")) {
      const rect = rectOf(building, catalog);
      if (rect && !landCovers({ owned, outline }, rect))
        out.push(
          error(
            "W041",
            `${withJosa(building.name, "은")} 확보한 부지 밖에 있어요`,
            "부지를 더 확보하거나 건물을 확보한 부지 안으로 옮겨요.",
            building.id,
          ),
        );
    }
  }
  return out;
}

/**
 * Why a building cannot stand at this place (REQ-043, REQ-048): the land is not the owner's yet. Says which
 * parcel for sale covers the place, so the builder can offer to buy it. Undefined when it can stand there.
 */
export function landProblem(
  index: BlueprintIndex,
  catalog: Catalog,
  rect: Rect,
): { readonly message: string; readonly parcelId?: string } | undefined {
  const site = index.ofKind("site")[0];
  if (!site) return undefined;
  const parcels = index.childrenOf(site.id, "parcel");
  const outline = parseOutline(site.props.outline);
  if (parcels.length === 0 && !outline) return undefined;
  const owned = parcels.filter(isOwned).flatMap((p) => rectOf(p, catalog) ?? []);
  if (landCovers({ owned, outline }, rect)) return undefined;
  const forSale = parcels.find((p) => {
    const r = rectOf(p, catalog);
    return !isOwned(p) && r !== undefined && overlaps(r, rect);
  });
  if (!forSale) return { message: "이 땅은 내 땅이 아니에요. 사업장 안쪽에 지어 주세요" };
  return {
    message: `${withJosa(forSale.name, "은")} 아직 사지 않은 땅이에요. 먼저 사 주세요`,
    parcelId: forSale.id,
  };
}

/** Land a site holds: the shape it was founded with, and any parcels bought later. */
interface Holdings {
  readonly owned: readonly Rect[];
  readonly outline: Outline | undefined;
}

/** Slack at the edge of the land, metres: outlines are approximate, so a wall may touch the line. */
const EDGE_SLACK_M = 3;

/**
 * Whether a building stands on land the owner holds: inside the site's own shape, inside one owned
 * parcel, or across several of them that share edges.
 */
function landCovers(land: Holdings, rect: Rect): boolean {
  if (land.owned.some((p) => contains(p, rect))) return true;
  // A building may straddle the shape and a parcel, or two parcels: sample its area on a grid.
  const inset = Math.min(EDGE_SLACK_M, rect.w / 3, rect.d / 3);
  const r = { x: rect.x + inset, y: rect.y + inset, w: rect.w - 2 * inset, d: rect.d - 2 * inset };
  const steps = 8;
  for (let i = 0; i <= steps; i++)
    for (let j = 0; j <= steps; j++) {
      const point = { x: r.x + (r.w * i) / steps, y: r.y + (r.d * j) / steps };
      if (!held(land, point)) return false;
    }
  return true;
}

function held(land: Holdings, p: { x: number; y: number }): boolean {
  if (land.outline && pointInOutline(p, land.outline)) return true;
  return land.owned.some(
    (q) =>
      p.x >= q.x - 1e-6 && p.x <= q.x + q.w + 1e-6 && p.y >= q.y - 1e-6 && p.y <= q.y + q.d + 1e-6,
  );
}

/** A server must be built for how its rack is cooled. */
export function checkCoolingFit(index: BlueprintIndex, catalog: Catalog): Issue[] {
  const out: Issue[] = [];
  for (const rack of index.ofKind("rack")) {
    const rackModel =
      rack.modelId && catalog.has(rack.modelId) && catalog.get(rack.modelId).kind === "rack"
        ? catalog.getOf(rack.modelId, "rack")
        : undefined;
    const method = rackModel?.cooling ?? "air";
    for (const server of index.childrenOf(rack.id, "server")) {
      if (!server.modelId || !catalog.has(server.modelId)) continue;
      const model = catalog.get(server.modelId);
      if (model.kind !== "server") continue;
      const problem = fitProblem(model.cooling, method);
      if (problem)
        out.push(
          error(
            "W030",
            `${withJosa(server.name, "은")} ${problem}`,
            "냉각 방식이 맞는 랙에 둬요.",
            server.id,
          ),
        );
    }
  }
  return out;
}

export function fitProblem(server: string, rack: string): string | undefined {
  if (server === "immersion" && rack !== "immersion")
    return "액침 전용이라 액침 탱크에만 둘 수 있어요";
  if (rack === "immersion" && server !== "immersion")
    return "액침용이 아니라 액침 탱크에 둘 수 없어요";
  if (server === "dlc" && rack !== "dlc") return "수랭 서버라 수랭 랙에만 둘 수 있어요";
  return undefined;
}

type CooledBy = (id: string, kinds: readonly string[]) => boolean;

function rackLoopIssues(index: BlueprintIndex, catalog: Catalog, cooledBy: CooledBy): Issue[] {
  const out: Issue[] = [];
  for (const rack of index.ofKind("rack")) {
    const model = rack.modelId && catalog.has(rack.modelId) ? catalog.get(rack.modelId) : undefined;
    if (model?.kind !== "rack" || model.cooling === "air") continue;
    const needed = model.cooling === "rdhx" ? ["cdu", "chiller"] : ["cdu"];
    if (!cooledBy(rack.id, needed))
      out.push(
        warning(
          "W031",
          `${withJosa(rack.name, "은")} ${model.cooling === "immersion" ? "액침 탱크" : "수랭 랙"}인데 냉각수를 받을 CDU가 연결되지 않았어요`,
          "냉방 연결로 CDU를 이어요.",
          rack.id,
        ),
      );
  }
  return out;
}

function plantLoopIssues(index: BlueprintIndex, catalog: Catalog, cooledBy: CooledBy): Issue[] {
  const out: Issue[] = [];
  for (const cdu of index.ofKind("cdu"))
    if (!cooledBy(cdu.id, ["chiller"]))
      out.push(
        warning(
          "W032",
          `${withJosa(cdu.name, "은")} 열을 내보낼 냉각 플랜트가 연결되지 않았어요`,
          "칠러·드라이쿨러·냉각탑을 이어요.",
          cdu.id,
        ),
      );
  for (const unit of index.ofKind("cooling_unit")) {
    const model = unit.modelId && catalog.has(unit.modelId) ? catalog.get(unit.modelId) : undefined;
    if (model?.kind === "cooling_unit" && model.chilledWater && !cooledBy(unit.id, ["chiller"]))
      out.push(
        warning(
          "W033",
          `${withJosa(unit.name, "은")} 냉수식인데 냉수를 줄 냉각 플랜트가 연결되지 않았어요`,
          "칠러를 이어요.",
          unit.id,
        ),
      );
  }
  return out;
}

/** Loops need a source: liquid racks a CDU, CDUs and chilled-water units a plant. */
export function checkLoops(index: BlueprintIndex, catalog: Catalog): Issue[] {
  const cooledBy: CooledBy = (id, kinds) =>
    index.outgoing(id, "cooling").some((l) => kinds.includes(index.entity(l.to).kind));
  return [
    ...rackLoopIssues(index, catalog, cooledBy),
    ...plantLoopIssues(index, catalog, cooledBy),
  ];
}
