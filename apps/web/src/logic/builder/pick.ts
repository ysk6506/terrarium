/**
 * 고른 것 카드 (REQ-077, ADR-0083): the right panel starts with one thing, the one picked (or the place being
 * looked at when nothing is). It says its name, one line of how it stands, and ONE main button that the state
 * chooses: an empty server room is filled, a full one is widened, one that is ready is run. Everything else on the
 * panel is folded under it.
 */
import type { Catalog } from "@terrarium/core/catalog";
import {
  type Blueprint,
  type BlueprintIndex,
  type Entity,
  KIND_LABELS,
  roomPurposeOf,
} from "@terrarium/core/world";
import { count } from "../format";
import { nextStep } from "../next-step";
import { floorsOf, type Level } from "./levels";
import { elevation } from "./rack";
import { roomFull, WIDEN_ROOM } from "./room-space";
import { levelStats } from "./stats";

/** `next`: go where the 다음 할 일 chip points (a server room that is still bare, from the site or a floor). */
export type PickPrimaryId = "fill" | "widen" | "run" | "enter" | "build" | "make-room" | "next";

export interface PickPrimary {
  readonly id: PickPrimaryId;
  readonly label: string;
  /** Set when the button is switched off: why, in the button's own words. */
  readonly why?: string;
}

export interface PickCard {
  readonly name: string;
  /** "랙 48대 · 서버 0대 · 비어 있어요" */
  readonly status: string;
  /** The one main button; none for things that have nothing to do on their own (a rack, a cable). */
  readonly primary?: PickPrimary;
  /** The place or thing the card is about, for the folded sections. */
  readonly entityId?: string;
}

export const RUN = "돌려 보기";
export const RUN_OFF = "돌려 본 결과 끄기";
const FILL = "서버룸 채우기";
const BLOCKED_FILL = "이미 놓은 것이 있어요. 지우고 비운 서버룸에서 채워요";

const run = (ran: boolean): PickPrimary => ({ id: "run", label: ran ? RUN_OFF : RUN });

/** Where nothing is picked: a server room still bare comes first, and only then is there something to run. */
function bareOr(index: BlueprintIndex, ran: boolean): PickPrimary {
  const step = nextStep(index, ran);
  if (step.id === "room") return { id: "make-room", label: "서버룸 만들기" };
  return step.id === "fill" ? { id: "next", label: FILL } : run(ran);
}

/** A server room: empty → fill, full → widen, otherwise run. */
function roomPrimary(
  bp: Blueprint,
  index: BlueprintIndex,
  catalog: Catalog,
  room: Entity,
  ran: boolean,
): { status: string; primary: PickPrimary } {
  const racks = index.descendants(room.id).filter((e) => e.kind === "rack").length;
  const things = index.childrenOf(room.id).length;
  const servers = index.descendants(room.id).filter((e) => e.kind === "server").length;
  if (racks === 0 && things === 0)
    return { status: "랙 0대 · 비어 있어요", primary: { id: "fill", label: FILL } };
  if (racks === 0)
    return {
      status: "랙 0대 · 다른 설비만 있어요",
      primary: { id: "fill", label: FILL, why: BLOCKED_FILL },
    };
  const head = `랙 ${count(racks)}대 · 서버 ${count(servers)}대`;
  if (roomFull(bp, catalog, room.id))
    return { status: `${head} · 꽉 찼어요`, primary: { id: "widen", label: WIDEN_ROOM } };
  return { status: head, primary: run(ran) };
}

function buildingLine(index: BlueprintIndex, building: Entity): string {
  const floors = floorsOf(index, building.id).length;
  const rooms = index.descendants(building.id).filter((e) => e.kind === "room").length;
  return `${count(floors)}층 · 서버룸 등 방 ${count(rooms)}개`;
}

function placeLine(index: BlueprintIndex, catalog: Catalog, level: Level): string {
  const stats = levelStats(index, catalog, level);
  if (level.kind === "site") {
    const buildings = index.ofKind("building").length;
    return `건물 ${count(buildings)}동 · 랙 ${count(stats.racks)}대`;
  }
  const rooms = index.childrenOf(level.id, "room").length;
  return `방 ${count(rooms)}개 · 랙 ${count(stats.racks)}대`;
}

/** What the card says about a level when nothing is picked. */
function ofLevel(
  bp: Blueprint,
  index: BlueprintIndex,
  catalog: Catalog,
  level: Level,
  ran: boolean,
): PickCard {
  if (level.kind === "room") {
    const room = index.entity(level.id);
    if (roomPurposeOf(room) !== "data_hall")
      return { name: room.name, status: "서버를 두지 않는 방이에요", entityId: room.id };
    return { name: room.name, entityId: room.id, ...roomPrimary(bp, index, catalog, room, ran) };
  }
  if (level.kind === "floor") {
    const floor = index.entity(level.id);
    const building = index.enclosing(floor.id, "building");
    const rooms = index.childrenOf(floor.id, "room").length;
    return {
      name: `${building?.name ?? ""} ${floor.name}`.trim(),
      status: placeLine(index, catalog, level),
      primary: rooms === 0 ? { id: "make-room", label: "서버룸 만들기" } : bareOr(index, ran),
      entityId: floor.id,
    };
  }
  const site = index.ofKind("site")[0];
  const buildings = index.ofKind("building").length;
  return {
    name: site?.name ?? "사업장",
    status: placeLine(index, catalog, level),
    primary: buildings === 0 ? { id: "build", label: "건물 올리기" } : bareOr(index, ran),
    ...(site ? { entityId: site.id } : {}),
  };
}

/** What the card says about one picked thing. */
function ofEntity(
  bp: Blueprint,
  index: BlueprintIndex,
  catalog: Catalog,
  entity: Entity,
  ran: boolean,
): PickCard {
  if (entity.kind === "room" && roomPurposeOf(entity) === "data_hall")
    return {
      name: entity.name,
      entityId: entity.id,
      ...roomPrimary(bp, index, catalog, entity, ran),
    };
  if (entity.kind === "building")
    return {
      name: entity.name,
      status: buildingLine(index, entity),
      primary: { id: "enter", label: "들어가기" },
      entityId: entity.id,
    };
  if (entity.kind === "rack") {
    const ev = elevation(index, catalog, entity.id);
    const servers = index.descendants(entity.id).filter((e) => e.kind === "server").length;
    return {
      name: entity.name,
      status: `서버 ${count(servers)}대 · 빈 곳 ${count(ev.freeUnits)}U`,
      entityId: entity.id,
    };
  }
  return { name: entity.name, status: KIND_LABELS[entity.kind], entityId: entity.id };
}

/**
 * The card for what is picked, or for the level when nothing is. `ran` is whether the world has been run this
 * visit; the card only reads it to say "돌려 본 결과 끄기" in place of "돌려 보기".
 */
export function describePick(
  bp: Blueprint,
  index: BlueprintIndex,
  catalog: Catalog,
  level: Level,
  picked: Entity | undefined,
  ran: boolean,
): PickCard {
  return picked
    ? ofEntity(bp, index, catalog, picked, ran)
    : ofLevel(bp, index, catalog, level, ran);
}
