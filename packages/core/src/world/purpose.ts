/** What a room is for (REQ-043): a data centre is more than data halls. */
import type { Entity } from "./blueprint";

export const ROOM_PURPOSES = [
  "data_hall",
  "network",
  "electrical",
  "mechanical",
  "battery",
  "noc",
] as const;
export type RoomPurpose = (typeof ROOM_PURPOSES)[number];

export const ROOM_PURPOSE_LABELS: Readonly<Record<RoomPurpose, string>> = {
  data_hall: "데이터 홀",
  network: "통신실(MMR)",
  electrical: "전기실",
  mechanical: "기계실",
  battery: "배터리실",
  noc: "관제실(NOC)",
};

/** The purpose a room was given; rooms made before purposes existed are data halls. */
export function roomPurposeOf(room: Entity): RoomPurpose {
  const set = room.props.purpose;
  return ROOM_PURPOSES.find((p) => p === set) ?? "data_hall";
}
