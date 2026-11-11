/**
 * Blueprint validation. Errors make a blueprint unusable; warnings are what a tycoon game would show
 * as advice ("this rack has no cooling"). Messages are for people using the builder, in Korean.
 */
import { type Catalog, RACK_STANDARD_LABELS } from "@terrarium/core/catalog";
import { isEntityId, josa, withJosa } from "@terrarium/core/kernel";
import { profileProblems } from "@terrarium/core/physics/slots";
import { contains, overlaps, type Rect } from "@terrarium/core/spatial";
import {
  ALLOWED_PARENTS,
  type Blueprint,
  type Entity,
  isFloorStandingKind,
  isPlantKind,
  isRackMountedKind,
  LINK_RULES,
  MODELLED_KINDS,
  PLACEMENT_OF,
} from "./blueprint";
import { footprint, heightU, mountStandardOf, rackStandardOf, rackUnits } from "./geometry";
import { BlueprintIndex } from "./graph";
import { KIND_LABELS, kindList, LINK_LABELS } from "./labels";
import { insideRoomLocal, roomRects } from "./room-shape";
import { checkLightRacks } from "./validate-bulk";
import { checkCoolingFit, checkLoops, checkParcels } from "./validate-campus";
import { checkRoomShapes } from "./validate-room";

export interface Issue {
  readonly severity: "error" | "warning";
  readonly code: string;
  readonly message: string;
  readonly fix: string;
  readonly entityId?: string;
  readonly linkId?: string;
}

const error = (
  code: string,
  message: string,
  fix: string,
  at: { entityId?: string; linkId?: string } = {},
): Issue => ({ severity: "error", code, message, fix, ...at });
const warning = (
  code: string,
  message: string,
  fix: string,
  at: { entityId?: string; linkId?: string } = {},
): Issue => ({ severity: "warning", code, message, fix, ...at });

function checkIds(bp: Blueprint): Issue[] {
  const out: Issue[] = [];
  const seen = new Set<string>();
  for (const item of [...bp.entities, ...bp.links]) {
    if (!isEntityId(item.id))
      out.push(
        error(
          "W002",
          `'${item.id}'${josa(item.id, "은")} 쓸 수 없는 ID예요`,
          "영문·숫자·_ . : - 만 써요.",
          {
            entityId: item.id,
          },
        ),
      );
    if (seen.has(item.id))
      out.push(
        error("W001", `ID '${item.id}'${josa(item.id, "이")} 두 번 있어요`, "ID를 하나씩만 써요.", {
          entityId: item.id,
        }),
      );
    seen.add(item.id);
  }
  return out;
}

function checkParent(index: BlueprintIndex, entity: Entity): Issue[] {
  const allowed = ALLOWED_PARENTS[entity.kind];
  const at = { entityId: entity.id };
  if (entity.parentId === undefined) {
    return allowed.length === 0
      ? []
      : [
          error(
            "W004",
            `${entity.name}에 상위 공간이 없어요`,
            `${allowed.map((k) => KIND_LABELS[k]).join(" 또는 ")} 안에 둬요.`,
            at,
          ),
        ];
  }
  const parent = index.find(entity.parentId);
  if (!parent)
    return [
      error(
        "W003",
        `${entity.name}의 상위 '${entity.parentId}'${josa(entity.parentId, "이")} 없어요`,
        "있는 공간 안에 둬요.",
        at,
      ),
    ];
  if (!allowed.includes(parent.kind)) {
    return [
      error(
        "W004",
        `${withJosa(KIND_LABELS[entity.kind], "은")} ${KIND_LABELS[parent.kind]} 안에 둘 수 없어요`,
        allowed.length > 0
          ? `${allowed.map((k) => KIND_LABELS[k]).join(" 또는 ")} 안에 둬요.`
          : "상위 공간 없이 둬요.",
        at,
      ),
    ];
  }
  return [];
}

function checkPlacementAndModel(catalog: Catalog, entity: Entity): Issue[] {
  const out: Issue[] = [];
  const at = { entityId: entity.id };
  const expected = PLACEMENT_OF[entity.kind];
  if (expected !== undefined && entity.placement?.type !== expected) {
    out.push(
      error(
        "W005",
        `${entity.name}의 위치 정보가 없거나 형식이 달라요`,
        `'${expected}' 형식의 위치를 정해요.`,
        at,
      ),
    );
  }
  if (MODELLED_KINDS.has(entity.kind) || (entity.kind === "rack" && entity.modelId)) {
    if (!entity.modelId || !catalog.has(entity.modelId)) {
      out.push(
        error(
          "W006",
          `${entity.name}의 장비 모델 '${entity.modelId ?? ""}'${josa(entity.modelId ?? "", "을")} 찾을 수 없어요`,
          "카탈로그에 있는 모델을 골라요.",
          at,
        ),
      );
    } else if (catalog.get(entity.modelId).kind !== entity.kind) {
      out.push(
        error(
          "W006",
          `${entity.name}의 모델은 ${KIND_LABELS[catalog.get(entity.modelId).kind]}용이에요`,
          `${KIND_LABELS[entity.kind]}용 모델을 골라요.`,
          at,
        ),
      );
    }
  }
  return out;
}

/** The area an entity's coordinates live in: a room for racks/equipment, a building for floors' contents. */
function parentArea(index: BlueprintIndex, catalog: Catalog, entity: Entity): Rect | undefined {
  if (entity.parentId === undefined) return undefined;
  const container =
    entity.kind === "rack" || isFloorStandingKind(entity.kind)
      ? (index.enclosing(entity.parentId, "room") ?? index.find(entity.parentId))
      : index.find(entity.parentId);
  if (!container) return undefined;
  const target =
    container.kind === "floor" && container.parentId ? index.find(container.parentId) : container;
  const area = target ? footprint(target, catalog) : undefined;
  return area ? { x: 0, y: 0, w: area.w, d: area.d } : undefined;
}

/** The room with pieces whose floor an entity stands on: what it must fit is the union, not the body. */
function pieceRoomOf(index: BlueprintIndex, entity: Entity): Entity | undefined {
  if (entity.parentId === undefined) return undefined;
  if (entity.kind !== "rack" && entity.kind !== "containment" && !isFloorStandingKind(entity.kind))
    return undefined;
  const room = index.enclosing(entity.parentId, "room") ?? index.find(entity.parentId);
  return room?.kind === "room" && room.placement?.type === "area" && room.placement.pieces?.length
    ? room
    : undefined;
}

function checkBounds(index: BlueprintIndex, catalog: Catalog, entity: Entity): Issue[] {
  const rect = entity.placement?.type === "land" ? undefined : footprint(entity, catalog);
  if (!rect) return [];
  if (rect.w <= 0 || rect.d <= 0)
    return [
      error("W007", `${entity.name}의 크기가 0 이하예요`, "폭과 깊이를 양수로 정해요.", {
        entityId: entity.id,
      }),
    ];
  const area = parentArea(index, catalog, entity);
  const room = pieceRoomOf(index, entity);
  const fits = room ? insideRoomLocal(room, rect) : area && contains(area, rect);
  if (area && !fits) {
    return [
      error(
        "W007",
        `${withJosa(entity.name, "이")} 상위 공간 밖으로 나가요`,
        "안쪽으로 옮기거나 공간을 넓혀요.",
        { entityId: entity.id },
      ),
    ];
  }
  return [];
}

/** The things an entity must not overlap: equipment in its room, plant and buildings in the yard, others of its kind. */
function occupantGroup(index: BlueprintIndex, entity: Entity, parentId: string): string {
  if (entity.kind === "rack" || isFloorStandingKind(entity.kind))
    return `equip:${index.enclosing(parentId, "room")?.id ?? parentId}`;
  const yard = entity.kind !== "parcel" && index.find(parentId)?.kind === "site";
  return yard || isPlantKind(entity.kind) ? `yard:${parentId}` : `${entity.kind}:${parentId}`;
}

/** Things that take floor space and must not overlap, grouped by the area they stand in. */
function occupants(
  index: BlueprintIndex,
  catalog: Catalog,
): Map<string, Array<{ entity: Entity; rect: Rect }>> {
  const groups = new Map<string, Array<{ entity: Entity; rect: Rect }>>();
  for (const entity of index.all()) {
    const rect = footprint(entity, catalog);
    if (!rect || entity.placement?.type === "land" || !entity.parentId) continue;
    const group = occupantGroup(index, entity, entity.parentId);
    const list = groups.get(group) ?? [];
    for (const r of floorOf(entity, rect)) list.push({ entity, rect: r });
    groups.set(group, list);
  }
  return groups;
}

/** The floor a thing takes: its rectangle, or every piece of a room made of pieces. */
const floorOf = (entity: Entity, rect: Rect): Rect[] =>
  entity.kind === "room" ? roomRects(entity) : [rect];

function checkOverlaps(index: BlueprintIndex, catalog: Catalog): Issue[] {
  const out: Issue[] = [];
  for (const members of occupants(index, catalog).values()) {
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const a = members[i] as { entity: Entity; rect: Rect };
        const b = members[j] as { entity: Entity; rect: Rect };
        if (a.entity.id !== b.entity.id && overlaps(a.rect, b.rect)) {
          out.push(
            error(
              "W008",
              `${withJosa(a.entity.name, "과")} ${withJosa(b.entity.name, "이")} 겹쳐요`,
              "둘 중 하나를 옮겨요.",
              { entityId: b.entity.id },
            ),
          );
        }
      }
    }
  }
  return out;
}

/** A device built for the other rack standard does not mount: 21-inch sleds in a 19-inch rack, or the reverse. */
function standardIssue(device: Entity, rack: Entity, catalog: Catalog): Issue | undefined {
  const wants = mountStandardOf(device, catalog);
  const has = rackStandardOf(rack, catalog);
  if (wants === has) return undefined;
  return error(
    "W034",
    `${withJosa(device.name, "은")} ${RACK_STANDARD_LABELS[wants]}용이라 ${RACK_STANDARD_LABELS[has]} 랙 ${rack.name}에 들어가지 않아요`,
    "같은 규격의 장비나 랙으로 바꿔요.",
    { entityId: device.id },
  );
}

function checkRackUnits(index: BlueprintIndex, catalog: Catalog): Issue[] {
  const out: Issue[] = [];
  for (const rack of index.ofKind("rack")) {
    const units = rackUnits(rack, catalog);
    const used = new Map<number, string>();
    for (const device of index.childrenOf(rack.id).filter((d) => isRackMountedKind(d.kind))) {
      const height = heightU(device, catalog);
      const u = device.placement?.type === "unit" ? device.placement.u : 0;
      if (height === 0) continue;
      const mismatch = standardIssue(device, rack, catalog);
      if (mismatch) {
        out.push(mismatch);
        continue;
      }
      if (u < 1 || u + height - 1 > units) {
        out.push(
          error(
            "W009",
            `${withJosa(device.name, "이")} 랙 범위(1~${units}U)를 벗어나요`,
            "빈 U 위치로 옮겨요.",
            { entityId: device.id },
          ),
        );
        continue;
      }
      for (let unit = u; unit < u + height; unit++) {
        const other = used.get(unit);
        if (other) {
          out.push(
            error(
              "W009",
              `${withJosa(device.name, "이")} U${unit}에서 ${withJosa(other, "과")} 겹쳐요`,
              "빈 U 위치로 옮겨요.",
              { entityId: device.id },
            ),
          );
          break;
        }
        used.set(unit, device.name);
      }
    }
  }
  return out;
}

function checkLinks(index: BlueprintIndex): Issue[] {
  const out: Issue[] = [];
  for (const link of index.allLinks()) {
    const at = { linkId: link.id };
    const from = index.find(link.from);
    const to = index.find(link.to);
    if (!from || !to) {
      out.push(error("W010", `연결 ${link.id}의 끝점이 없어요`, "있는 장비끼리 연결해요.", at));
      continue;
    }
    const rule = LINK_RULES[link.kind];
    if (link.from === link.to || !rule.from.includes(from.kind) || !rule.to.includes(to.kind)) {
      out.push(
        error(
          "W010",
          `${KIND_LABELS[from.kind]} → ${KIND_LABELS[to.kind]}에는 ${LINK_LABELS[link.kind]} 연결을 둘 수 없어요`,
          `${kindList(rule.from)} → ${kindList(rule.to)} 사이만 돼요.`,
          at,
        ),
      );
    }
  }
  for (const entity of index.all()) {
    if (index.inCycle(entity.id, "power")) {
      out.push(
        error(
          "W011",
          `${entity.name}의 전원 경로가 자기 자신으로 돌아와요`,
          "전원 연결의 순환을 끊어요.",
          { entityId: entity.id },
        ),
      );
    }
  }
  return out;
}

function adviceWarnings(index: BlueprintIndex): Issue[] {
  const out: Issue[] = [];
  for (const entity of index.all()) {
    const at = { entityId: entity.id };
    const needsPower = ["server", "switch", "storage", "cooling_unit"].includes(entity.kind);
    if (needsPower && index.outgoing(entity.id, "power").length === 0) {
      out.push(
        warning(
          "W020",
          `${entity.name}에 전원이 연결되지 않았어요`,
          "PDU나 분전반에 전원 케이블을 연결해요.",
          at,
        ),
      );
    }
    if (entity.kind === "pdu" && index.outgoing(entity.id, "power").length === 0) {
      out.push(
        warning("W021", `${entity.name}의 상위 전원(분전반)이 없어요`, "분전반에 연결해요.", at),
      );
    }
  }
  for (const room of index.ofKind("room")) {
    const hasRacks = index.descendants(room.id).some((e) => e.kind === "rack");
    const hasCooling = index.descendants(room.id).some((e) => e.kind === "cooling_unit");
    if (hasRacks && !hasCooling) {
      out.push(
        warning("W022", `${room.name}에 냉방 설비가 없어요`, "항온항습기나 인로우 냉방기를 둬요.", {
          entityId: room.id,
        }),
      );
    }
  }
  return out;
}

/** Parents that lead back to themselves: nothing below them can be placed, so the rest is not checked. */
function checkParentLoops(index: BlueprintIndex): Issue[] {
  return index
    .all()
    .filter((entity) => index.inParentLoop(entity.id))
    .map((entity) =>
      error(
        "W012",
        `${entity.name}의 상위 공간을 따라가면 다시 ${entity.name}${josa(entity.name, "이")} 나와요`,
        "상위 공간을 한 방향으로만 이어요. 돌고 도는 연결 하나를 끊어요.",
        { entityId: entity.id },
      ),
    );
}

/** The physics profile of the world (REQ-113) has to be one the engine can use. */
function checkPhysics(bp: Blueprint): Issue[] {
  if (bp.physics === undefined) return [];
  return profileProblems(bp.physics).map((m) =>
    error(
      "P001",
      `물리 프로필: ${m}`,
      "물리 프로필의 숫자·곡선·날씨를 허용 범위 안으로 고쳐 주세요.",
    ),
  );
}

export function validateBlueprint(bp: Blueprint, catalog: Catalog): Issue[] {
  const index = new BlueprintIndex(bp);
  const loops = checkParentLoops(index);
  if (loops.length > 0) return [...checkIds(bp), ...loops];
  const perEntity = index
    .all()
    .flatMap((entity) => [
      ...checkParent(index, entity),
      ...checkPlacementAndModel(catalog, entity),
      ...checkBounds(index, catalog, entity),
    ]);
  return [
    ...checkIds(bp),
    ...checkPhysics(bp),
    ...perEntity,
    ...checkOverlaps(index, catalog),
    ...checkRoomShapes(index, catalog),
    ...checkRackUnits(index, catalog),
    ...checkLinks(index),
    ...checkParcels(index, catalog),
    ...checkCoolingFit(index, catalog),
    ...checkLightRacks(index, catalog),
    ...checkLoops(index, catalog),
    ...adviceWarnings(index),
  ];
}

export const hasErrors = (issues: readonly Issue[]): boolean =>
  issues.some((i) => i.severity === "error");
