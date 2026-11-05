/**
 * What is done on the land itself (REQ-043, REQ-048): buying a parcel that is for sale, putting up a
 * building on land that is the owner's, and standing plant (transformers, generators, chillers)
 * beside the buildings. Pure like the rest of the edits: blueprint in, blueprint out, or the reason why not.
 */
import type { Catalog } from "@terrarium/core/catalog";
import { withJosa } from "@terrarium/core/kernel";
import type { Rect } from "@terrarium/core/spatial";
import {
  type Blueprint,
  BlueprintIndex,
  BUILDING_PURPOSE_LABELS,
  type BuildingPurpose,
  DEFAULT_FLOOR_HEIGHT_M,
  type Entity,
  footprint,
  isOwned,
  landProblem,
} from "@terrarium/core/world";
import { won } from "../format";
import {
  assertFree,
  type Edit,
  EditError,
  footprintAt,
  GRID,
  groundTakers,
  nextId,
  nextName,
  PLANT_KINDS,
  replaceEntity,
  type Spot,
  snapRect,
  withEntities,
} from "./edit";
import { levelArea, siteOf } from "./levels";

/** A parcel as the builder shows it: where it is, whether it is the owner's, and what it would cost. */
export interface ParcelView {
  readonly id: string;
  readonly name: string;
  readonly rect: Rect;
  readonly owned: boolean;
  readonly areaM2: number;
  /** Million won; 0 for land that was never for sale. */
  readonly priceM: number;
}

export function parcelViews(index: BlueprintIndex, catalog: Catalog): ParcelView[] {
  const site = siteOf(index);
  if (!site) return [];
  return index.childrenOf(site.id, "parcel").flatMap((e) => {
    const rect = footprint(e, catalog);
    if (!rect) return [];
    return [
      {
        id: e.id,
        name: e.name,
        rect,
        owned: isOwned(e),
        areaM2: Number(e.props.areaM2) || Math.round(rect.w * rect.d),
        priceM: Number(e.props.priceM) || 0,
      },
    ];
  });
}

/** The parcel for sale that covers a point of the land, if any. */
export function parcelForSaleAt(
  index: BlueprintIndex,
  catalog: Catalog,
  at: { readonly x: number; readonly y: number },
): ParcelView | undefined {
  return parcelViews(index, catalog).find(
    (p) =>
      !p.owned &&
      at.x >= p.rect.x &&
      at.x <= p.rect.x + p.rect.w &&
      at.y >= p.rect.y &&
      at.y <= p.rect.y + p.rect.d,
  );
}

/** Whether a point lies on a parcel that is already the owner's. */
export function ownParcelAt(
  index: BlueprintIndex,
  catalog: Catalog,
  at: { readonly x: number; readonly y: number },
): boolean {
  return parcelViews(index, catalog).some(
    (p) =>
      p.owned &&
      at.x >= p.rect.x &&
      at.x <= p.rect.x + p.rect.w &&
      at.y >= p.rect.y &&
      at.y <= p.rect.y + p.rect.d,
  );
}

/** What the owner paid for land bought through the builder, million won. */
export function landCostM(index: BlueprintIndex): number {
  return index
    .ofKind("parcel")
    .reduce((sum, p) => sum + (p.props.owned === true ? Number(p.props.priceM) || 0 : 0), 0);
}

/** Buy a parcel that is for sale: it becomes the owner's land, and buildings may stand on it. */
export function buyParcel(bp: Blueprint, parcelId: string): Edit {
  const index = new BlueprintIndex(bp);
  const parcel = index.find(parcelId);
  if (!parcel || parcel.kind !== "parcel") throw new EditError("이 땅을 찾을 수 없어요");
  if (isOwned(parcel)) throw new EditError(`${withJosa(parcel.name, "은")} 이미 내 땅이에요`);
  const next = replaceEntity(bp, parcelId, (e) => ({ ...e, props: { ...e.props, owned: true } }));
  return { blueprint: next, select: [parcelId] };
}

/** "데이터센터 2": the purpose's word and the next number among the buildings of that purpose. */
function buildingName(index: BlueprintIndex, siteId: string, purpose?: BuildingPurpose): string {
  if (!purpose) return nextName(index, "building", siteId);
  const word = BUILDING_PURPOSE_LABELS[purpose];
  const top = index
    .childrenOf(siteId, "building")
    .map((b) => (b.name.startsWith(`${word} `) ? Number(b.name.slice(word.length + 1)) || 0 : 0));
  return `${word} ${Math.max(0, ...top) + 1}`;
}

/** Why a building cannot stand on this land: somebody else's, or not bought yet. */
export function landReason(
  index: BlueprintIndex,
  catalog: Catalog,
  rect: Rect,
): string | undefined {
  const problem = landProblem(index, catalog, rect);
  if (!problem) return undefined;
  const parcel = problem.parcelId ? index.find(problem.parcelId) : undefined;
  const price = Number(parcel?.props.priceM) || 0;
  return price > 0 ? `${problem.message} (${won(price)})` : problem.message;
}

export function addBuilding(
  bp: Blueprint,
  catalog: Catalog,
  rect: Rect,
  purpose?: BuildingPurpose,
): Edit {
  const index = new BlueprintIndex(bp);
  const site = siteOf(index);
  if (!site) throw new EditError("사업장이 없는 세계예요");
  const r = snapRect(rect, GRID.site, 10);
  assertFree(
    index,
    catalog,
    levelArea(index, catalog, { kind: "site" }),
    r,
    groundTakers(index, site.id),
    "건물",
  );
  const reason = landReason(index, catalog, r);
  if (reason) throw new EditError(reason);
  const id = nextId(index, "building");
  const building: Entity = {
    id,
    kind: "building",
    name: buildingName(index, site.id, purpose),
    parentId: site.id,
    placement: { type: "area", ...r },
    props: purpose ? { purpose } : {},
  };
  const floor: Entity = {
    id: nextId(index, "floor"),
    kind: "floor",
    name: "1층",
    parentId: id,
    placement: { type: "level", level: 1, height: DEFAULT_FLOOR_HEIGHT_M },
    props: {},
  };
  return { blueprint: withEntities(bp, [building, floor]), select: [id] };
}

/** Plant stands beside the buildings: a transformer, a generator or a chiller, on land that is the owner's. */
export function placePlant(bp: Blueprint, catalog: Catalog, modelId: string, spot: Spot): Edit {
  const model = catalog.get(modelId);
  if (!PLANT_KINDS.has(model.kind))
    throw new EditError(`${withJosa(model.name, "은")} 건물 밖에 세우는 설비가 아니에요`);
  const index = new BlueprintIndex(bp);
  const site = siteOf(index);
  if (!site) throw new EditError("사업장이 없는 세계예요");
  const rect = footprintAt(catalog, modelId, spot);
  const others = groundTakers(index, site.id);
  assertFree(index, catalog, levelArea(index, catalog, { kind: "site" }), rect, others, "이 자리");
  const reason = landReason(index, catalog, rect);
  if (reason) throw new EditError(reason);
  const id = nextId(index, model.kind);
  const transformer =
    model.kind === "power_panel" && "style" in model && model.style === "transformer";
  const entity: Entity = {
    id,
    kind: model.kind,
    name: nextName(index, model.kind, site.id, transformer ? "변압기" : undefined),
    parentId: site.id,
    modelId,
    placement: { type: "spot", ...spot },
    props: {},
  };
  return { blueprint: withEntities(bp, [entity]), select: [id] };
}
