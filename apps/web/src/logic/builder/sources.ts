/**
 * Where a room's cooling and power come from (REQ-076, ADR-0081): the units that cool its racks and the gear that feeds
 * them, grouped by what they are and where they stand (in the room, in another room of the building, in the yard), and
 * the ways to put more of it somewhere other than the room itself — the mechanical room or electrical room of the same
 * floor, or the yard beside the building, where plant already stands.
 */
import type { Catalog } from "@terrarium/core/catalog";
import {
  type BlueprintIndex,
  type Entity,
  KIND_LABELS,
  roomPurposeOf,
} from "@terrarium/core/world";
import type { Tool } from "./gesture";
import type { Level } from "./levels";

export interface SourceGroup {
  /** "CDU", "UPS", "냉수 플랜트". */
  readonly what: string;
  /** "이 방 안", "2F 기계실", "건물 밖 마당". */
  readonly where: string;
  readonly count: number;
}

/** What the models of a panel are called: a distribution board is not a transfer switch. */
const PANEL_WORDS: Readonly<Record<string, string>> = {
  panel: "분전반",
  switchgear: "수배전반",
  busway: "버스웨이",
  ats: "절체 스위치(ATS)",
  transformer: "변압기",
};

function whatIs(catalog: Catalog, e: Entity): string {
  const model = e.modelId && catalog.has(e.modelId) ? catalog.get(e.modelId) : undefined;
  if (model?.kind === "power_panel") return PANEL_WORDS[model.style] ?? KIND_LABELS[e.kind];
  if (model?.kind === "cooling_unit")
    return model.style === "inrow" ? "인로우 냉방기" : "항온항습기";
  if (model?.kind === "chiller")
    return { chiller: "냉동기", dry_cooler: "드라이쿨러", cooling_tower: "냉각탑" }[model.plant];
  return KIND_LABELS[e.kind];
}

/** Where a piece of equipment stands, in words relative to the room being asked about. */
function whereIs(index: BlueprintIndex, e: Entity, roomId: string): string {
  const room = index.enclosing(e.id, "room");
  if (room?.id === roomId) return "이 방 안";
  if (room) {
    const floor = index.enclosing(room.id, "floor");
    // "2F 기계실" already says which floor; "기계실 A" on "1층" does not.
    return floor && !room.name.startsWith(floor.name) ? `${floor.name} ${room.name}` : room.name;
  }
  const floor = index.enclosing(e.id, "floor");
  if (floor) return `${floor.name} 바닥`;
  return index.enclosing(e.id, "building") ? "건물 옥상" : "건물 밖 마당";
}

/** Everything the racks of a room reach by following `kind` links up to `depth` hops, of the kinds that supply. */
function suppliers(
  index: BlueprintIndex,
  roomId: string,
  kind: "cooling" | "power",
  wanted: ReadonlySet<Entity["kind"]>,
): Entity[] {
  const seen = new Set<string>();
  let frontier = index
    .descendants(roomId)
    .filter((e) => e.kind === "rack" || (kind === "power" && e.placement?.type === "unit"))
    .map((e) => e.id);
  const found: Entity[] = [];
  for (let hop = 0; hop < 6 && frontier.length > 0; hop++) {
    const next: string[] = [];
    for (const id of frontier)
      for (const link of index.outgoing(id, kind)) {
        if (seen.has(link.to)) continue;
        seen.add(link.to);
        const target = index.find(link.to);
        if (!target) continue;
        if (wanted.has(target.kind)) found.push(target);
        next.push(target.id);
      }
    frontier = next;
  }
  return found;
}

function grouped(
  index: BlueprintIndex,
  catalog: Catalog,
  roomId: string,
  list: readonly Entity[],
): SourceGroup[] {
  const groups = new Map<string, SourceGroup>();
  for (const e of list) {
    const what = whatIs(catalog, e);
    const where = whereIs(index, e, roomId);
    const key = `${what}|${where}`;
    const known = groups.get(key);
    groups.set(key, { what, where, count: (known?.count ?? 0) + 1 });
  }
  return [...groups.values()].sort((a, b) => b.count - a.count);
}

const COOLING_KINDS = new Set<Entity["kind"]>(["cooling_unit", "cdu", "chiller"]);
const POWER_KINDS = new Set<Entity["kind"]>(["power_panel", "ups", "generator"]);

export interface RoomSources {
  readonly cooling: readonly SourceGroup[];
  readonly power: readonly SourceGroup[];
}

/** What cools and feeds the racks of a room, and where each of those stands. */
export function roomSources(index: BlueprintIndex, catalog: Catalog, roomId: string): RoomSources {
  return {
    cooling: grouped(index, catalog, roomId, suppliers(index, roomId, "cooling", COOLING_KINDS)),
    power: grouped(index, catalog, roomId, suppliers(index, roomId, "power", POWER_KINDS)),
  };
}

export interface OutsideWay {
  readonly key: string;
  readonly label: string;
  /** Where to go, and what to pick up when there. */
  readonly level: Level;
  readonly tool: Tool;
}

/** What each way puts down: a coolant unit in the mechanical room, switchgear in the electrical room, plant in the yard. */
export const OUTSIDE_PICKS = {
  cooling: { room: "aq-cdu-500kw", yard: "gl-chiller-screw-1mw" },
  power: { room: "sy-switchgear-2000a", yard: "tg-diesel-1mw" },
} as const;

/**
 * Where else than in the room this room's cooling or power can be put: the mechanical or electrical room on the
 * same floor, and the yard (the plant the site already has). Each is a place to go to and a tool to pick up.
 */
export function outsideWays(
  index: BlueprintIndex,
  roomId: string,
  what: "cooling" | "power",
): OutsideWay[] {
  const room = index.find(roomId);
  const floor = room?.kind === "room" ? index.enclosing(roomId, "floor") : undefined;
  if (!room || !floor) return [];
  const purpose = what === "cooling" ? "mechanical" : "electrical";
  const picks = OUTSIDE_PICKS[what];
  const noun = what === "cooling" ? "냉각 설비" : "전력 설비";
  const ways: OutsideWay[] = index
    .childrenOf(floor.id, "room")
    .filter((r) => r.id !== roomId && roomPurposeOf(r) === purpose)
    .map((r) => ({
      key: `${what}:${r.id}`,
      label: `${r.name}에 ${noun} 놓기`,
      level: { kind: "room", id: r.id },
      tool: { kind: "equipment", modelId: picks.room },
    }));
  ways.push({
    key: `${what}:yard`,
    label: `건물 밖 마당에 ${what === "cooling" ? "냉각 플랜트" : "발전기"} 놓기`,
    level: { kind: "site" },
    tool: { kind: "plant", modelId: picks.yard },
  });
  return ways;
}
