/** What a room is for (REQ-043): a data centre is more than data halls. */
import type { Entity } from "./blueprint";

export const ROOM_PURPOSES = [
  "data_hall",
  "network",
  "electrical",
  "mechanical",
  "battery",
  "noc",
  "cleanroom",
  "storage",
  "lobby",
] as const;
export type RoomPurpose = (typeof ROOM_PURPOSES)[number];

export const ROOM_PURPOSE_LABELS: Readonly<Record<RoomPurpose, string>> = {
  data_hall: "데이터 홀",
  network: "통신실(MMR)",
  electrical: "전기실",
  mechanical: "기계실",
  battery: "배터리실",
  noc: "관제실(NOC)",
  cleanroom: "클린룸",
  storage: "창고",
  lobby: "로비·하역장",
};

/** The purpose a room was given; rooms made before purposes existed are data halls. */
export function roomPurposeOf(room: Entity): RoomPurpose {
  const set = room.props.purpose;
  return ROOM_PURPOSES.find((p) => p === set) ?? "data_hall";
}

/**
 * What a building is for (REQ-043): most server rooms of a semiconductor campus sit inside a fab, next
 * to its cleanrooms, and a few stand in data-centre buildings of their own.
 */
export const BUILDING_PURPOSES = ["data_center", "fab", "utility", "research"] as const;
export type BuildingPurpose = (typeof BUILDING_PURPOSES)[number];

export const BUILDING_PURPOSE_LABELS: Readonly<Record<BuildingPurpose, string>> = {
  data_center: "데이터센터",
  fab: "반도체 팹",
  utility: "유틸리티동",
  research: "연구동",
};

/** The purpose a building was given; buildings made before purposes existed are data centres. */
export function buildingPurposeOf(building: Entity): BuildingPurpose {
  const set = building.props.purpose;
  return BUILDING_PURPOSES.find((p) => p === set) ?? "data_center";
}
