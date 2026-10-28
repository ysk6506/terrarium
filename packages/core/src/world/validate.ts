/**
 * Blueprint validation. Errors make a blueprint unusable; warnings are what a tycoon game would show
 * as advice ("this rack has no cooling"). Messages are for people using the builder, in Korean.
 */
import type { Catalog } from "@terrarium/core/catalog";
import { isEntityId, RACK_UNITS_DEFAULT } from "@terrarium/core/kernel";
import { contains, overlaps, type Rect } from "@terrarium/core/spatial";
import {
  ALLOWED_PARENTS,
  type Blueprint,
  type Entity,
  isFloorStandingKind,
  isRackMountedKind,
  LINK_RULES,
  MODELLED_KINDS,
  PLACEMENT_OF,
} from "./blueprint";
import { footprint, heightU } from "./geometry";
import { BlueprintIndex } from "./graph";

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
        error("W002", `'${item.id}'는 쓸 수 없는 ID입니다`, "영문·숫자·_ . : - 만 쓰세요.", {
          entityId: item.id,
        }),
      );
    if (seen.has(item.id))
      out.push(
        error("W001", `ID '${item.id}'가 중복됩니다`, "ID를 하나만 쓰세요.", { entityId: item.id }),
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
            `${entity.name}에 상위 공간이 없습니다`,
            `${allowed.join(" 또는 ")} 안에 두세요.`,
            at,
          ),
        ];
  }
  const parent = index.find(entity.parentId);
  if (!parent)
    return [
      error(
        "W003",
        `${entity.name}의 상위 '${entity.parentId}'가 없습니다`,
        "존재하는 공간 안에 두세요.",
        at,
      ),
    ];
  if (!allowed.includes(parent.kind)) {
    return [
      error(
        "W004",
        `${entity.kind}는 ${parent.kind} 안에 둘 수 없습니다`,
        `${allowed.join(" 또는 ") || "상위 없이"} 두세요.`,
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
        `${entity.name}의 위치 정보가 없거나 형식이 다릅니다`,
        `'${expected}' 형식의 위치를 지정하세요.`,
        at,
      ),
    );
  }
  if (MODELLED_KINDS.has(entity.kind)) {
    if (!entity.modelId || !catalog.has(entity.modelId)) {
      out.push(
        error(
          "W006",
          `${entity.name}의 장비 모델 '${entity.modelId ?? ""}'을 찾을 수 없습니다`,
          "카탈로그에 있는 모델을 고르세요.",
          at,
        ),
      );
    } else if (catalog.get(entity.modelId).kind !== entity.kind) {
      out.push(
        error(
          "W006",
          `${entity.name}의 모델은 ${catalog.get(entity.modelId).kind}용입니다`,
          `${entity.kind}용 모델을 고르세요.`,
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
      error("W007", `${entity.name}의 크기가 0 이하입니다`, "폭과 깊이를 양수로 지정하세요.", {
        entityId: entity.id,
      }),
    ];
  const area = parentArea(index, catalog, entity);
  if (area && !contains(area, rect)) {
    return [
      error(
        "W007",
        `${entity.name}이(가) 상위 공간 밖으로 나갑니다`,
        "안쪽으로 옮기거나 공간을 넓히세요.",
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
    const group = isEquipment
      ? `equip:${index.enclosing(entity.parentId, "room")?.id ?? entity.parentId}`
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
              `${a.entity.name}와(과) ${b.entity.name}이(가) 겹칩니다`,
              "둘 중 하나를 옮기세요.",
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
    const units = Number(rack.props.units ?? RACK_UNITS_DEFAULT);
    const used = new Map<number, string>();
    for (const device of index.childrenOf(rack.id).filter((d) => isRackMountedKind(d.kind))) {
      const height = heightU(device, catalog);
      const u = device.placement?.type === "unit" ? device.placement.u : 0;
      if (height === 0) continue;
      if (u < 1 || u + height - 1 > units) {
        out.push(
          error(
            "W009",
            `${device.name}이(가) 랙 범위(1~${units}U)를 벗어납니다`,
            "빈 U 위치로 옮기세요.",
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
              `${device.name}이(가) U${unit}에서 ${other}와(과) 겹칩니다`,
              "빈 U 위치로 옮기세요.",
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
      out.push(
        error("W010", `연결 ${link.id}의 끝점이 없습니다`, "존재하는 장비끼리 연결하세요.", at),
      );
      continue;
    }
    const rule = LINK_RULES[link.kind];
    if (link.from === link.to || !rule.from.includes(from.kind) || !rule.to.includes(to.kind)) {
      out.push(
        error(
          "W010",
          `${from.kind} → ${to.kind}는 '${link.kind}' 연결이 될 수 없습니다`,
          `${rule.from.join("/")} → ${rule.to.join("/")} 사이만 가능합니다.`,
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
          `${entity.name}의 전원 경로가 자기 자신으로 돌아옵니다`,
          "전원 연결의 순환을 끊으세요.",
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
          `${entity.name}에 전원이 연결되지 않았습니다`,
          "PDU나 분전반에 전원 케이블을 연결하세요.",
          at,
        ),
      );
    }
    if (entity.kind === "pdu" && index.outgoing(entity.id, "power").length === 0) {
      out.push(
        warning(
          "W021",
          `${entity.name}의 상위 전원(분전반)이 없습니다`,
          "분전반에 연결하세요.",
          at,
        ),
      );
    }
  }
  for (const room of index.ofKind("room")) {
    const hasRacks = index.descendants(room.id).some((e) => e.kind === "rack");
    const hasCooling = index.descendants(room.id).some((e) => e.kind === "cooling_unit");
    if (hasRacks && !hasCooling) {
      out.push(
        warning(
          "W022",
          `${room.name}에 냉방 설비가 없습니다`,
          "항온항습기나 인로우 냉방기를 설치하세요.",
          { entityId: room.id },
        ),
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
    ...adviceWarnings(index),
  ];
}

export const hasErrors = (issues: readonly Issue[]): boolean =>
  issues.some((i) => i.severity === "error");
