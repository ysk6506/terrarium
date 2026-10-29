/**
 * Blueprint validation. Errors make a blueprint unusable; warnings are what a tycoon game would show
 * as advice ("this rack has no cooling"). Messages are for people using the builder, in Korean.
 */
import type { Catalog } from "@terrarium/core/catalog";
import { isEntityId, josa, withJosa } from "@terrarium/core/kernel";
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
import { footprint, heightU, rackUnits } from "./geometry";
import { BlueprintIndex } from "./graph";
import { KIND_LABELS, kindList, LINK_LABELS } from "./labels";
import { checkLightRacks } from "./validate-bulk";
import { checkCoolingFit, checkLoops, checkParcels } from "./validate-campus";

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
          `'${item.id}'${josa(item.id, "은")} 쓸 수 없는 ID다`,
          "영문·숫자·_ . : - 만 쓴다.",
          {
            entityId: item.id,
          },
        ),
      );
    if (seen.has(item.id))
      out.push(
        error("W001", `ID '${item.id}'${josa(item.id, "이")} 두 번 있다`, "ID를 하나씩만 쓴다.", {
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
            `${entity.name}에 상위 공간이 없다`,
            `${allowed.map((k) => KIND_LABELS[k]).join(" 또는 ")} 안에 둔다.`,
            at,
          ),
        ];
  }
  const parent = index.find(entity.parentId);
  if (!parent)
    return [
      error(
        "W003",
        `${entity.name}의 상위 '${entity.parentId}'${josa(entity.parentId, "이")} 없다`,
        "있는 공간 안에 둔다.",
        at,
      ),
    ];
  if (!allowed.includes(parent.kind)) {
    return [
      error(
        "W004",
        `${withJosa(KIND_LABELS[entity.kind], "은")} ${KIND_LABELS[parent.kind]} 안에 둘 수 없다`,
        allowed.length > 0
          ? `${allowed.map((k) => KIND_LABELS[k]).join(" 또는 ")} 안에 둔다.`
          : "상위 공간 없이 둔다.",
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
        `${entity.name}의 위치 정보가 없거나 형식이 다르다`,
        `'${expected}' 형식의 위치를 정한다.`,
        at,
      ),
    );
  }
  if (MODELLED_KINDS.has(entity.kind) || (entity.kind === "rack" && entity.modelId)) {
    if (!entity.modelId || !catalog.has(entity.modelId)) {
      out.push(
        error(
          "W006",
          `${entity.name}의 장비 모델 '${entity.modelId ?? ""}'${josa(entity.modelId ?? "", "을")} 찾을 수 없다`,
          "카탈로그에 있는 모델을 고른다.",
          at,
        ),
      );
    } else if (catalog.get(entity.modelId).kind !== entity.kind) {
      out.push(
        error(
          "W006",
          `${entity.name}의 모델은 ${KIND_LABELS[catalog.get(entity.modelId).kind]}용이다`,
          `${KIND_LABELS[entity.kind]}용 모델을 고른다.`,
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

function checkBounds(index: BlueprintIndex, catalog: Catalog, entity: Entity): Issue[] {
  const rect = entity.placement?.type === "land" ? undefined : footprint(entity, catalog);
  if (!rect) return [];
  if (rect.w <= 0 || rect.d <= 0)
    return [
      error("W007", `${entity.name}의 크기가 0 이하다`, "폭과 깊이를 양수로 정한다.", {
        entityId: entity.id,
      }),
    ];
  const area = parentArea(index, catalog, entity);
  if (area && !contains(area, rect)) {
    return [
      error(
        "W007",
        `${withJosa(entity.name, "이")} 상위 공간 밖으로 나간다`,
        "안쪽으로 옮기거나 공간을 넓힌다.",
        { entityId: entity.id },
      ),
    ];
  }
  return [];
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
    const isEquipment = entity.kind === "rack" || isFloorStandingKind(entity.kind);
    const yard = entity.kind !== "parcel" && index.find(entity.parentId)?.kind === "site";
    const group = isEquipment
      ? `equip:${index.enclosing(entity.parentId, "room")?.id ?? entity.parentId}`
      : yard || isPlantKind(entity.kind)
        ? `yard:${entity.parentId}`
        : `${entity.kind}:${entity.parentId}`;
    const list = groups.get(group) ?? [];
    list.push({ entity, rect });
    groups.set(group, list);
  }
  return groups;
}

function checkOverlaps(index: BlueprintIndex, catalog: Catalog): Issue[] {
  const out: Issue[] = [];
  for (const members of occupants(index, catalog).values()) {
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const a = members[i] as { entity: Entity; rect: Rect };
        const b = members[j] as { entity: Entity; rect: Rect };
        if (overlaps(a.rect, b.rect)) {
          out.push(
            error(
              "W008",
              `${withJosa(a.entity.name, "과")} ${withJosa(b.entity.name, "이")} 겹친다`,
              "둘 중 하나를 옮긴다.",
              { entityId: b.entity.id },
            ),
          );
        }
      }
    }
  }
  return out;
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
      if (u < 1 || u + height - 1 > units) {
        out.push(
          error(
            "W009",
            `${withJosa(device.name, "이")} 랙 범위(1~${units}U)를 벗어난다`,
            "빈 U 위치로 옮긴다.",
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
              `${withJosa(device.name, "이")} U${unit}에서 ${withJosa(other, "과")} 겹친다`,
              "빈 U 위치로 옮긴다.",
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
      out.push(error("W010", `연결 ${link.id}의 끝점이 없다`, "있는 장비끼리 연결한다.", at));
      continue;
    }
    const rule = LINK_RULES[link.kind];
    if (link.from === link.to || !rule.from.includes(from.kind) || !rule.to.includes(to.kind)) {
      out.push(
        error(
          "W010",
          `${KIND_LABELS[from.kind]} → ${KIND_LABELS[to.kind]}에는 ${LINK_LABELS[link.kind]} 연결을 둘 수 없다`,
          `${kindList(rule.from)} → ${kindList(rule.to)} 사이만 된다.`,
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
          `${entity.name}의 전원 경로가 자기 자신으로 돌아온다`,
          "전원 연결의 순환을 끊는다.",
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
          `${entity.name}에 전원이 연결되지 않았다`,
          "PDU나 분전반에 전원 케이블을 연결한다.",
          at,
        ),
      );
    }
    if (entity.kind === "pdu" && index.outgoing(entity.id, "power").length === 0) {
      out.push(
        warning("W021", `${entity.name}의 상위 전원(분전반)이 없다`, "분전반에 연결한다.", at),
      );
    }
  }
  for (const room of index.ofKind("room")) {
    const hasRacks = index.descendants(room.id).some((e) => e.kind === "rack");
    const hasCooling = index.descendants(room.id).some((e) => e.kind === "cooling_unit");
    if (hasRacks && !hasCooling) {
      out.push(
        warning("W022", `${room.name}에 냉방 설비가 없다`, "항온항습기나 인로우 냉방기를 둔다.", {
          entityId: room.id,
        }),
      );
    }
  }
  return out;
}

export function validateBlueprint(bp: Blueprint, catalog: Catalog): Issue[] {
  const index = new BlueprintIndex(bp);
  const perEntity = index
    .all()
    .flatMap((entity) => [
      ...checkParent(index, entity),
      ...checkPlacementAndModel(catalog, entity),
      ...checkBounds(index, catalog, entity),
    ]);
  return [
    ...checkIds(bp),
    ...perEntity,
    ...checkOverlaps(index, catalog),
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
