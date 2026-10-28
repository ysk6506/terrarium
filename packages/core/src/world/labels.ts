/** Korean names of entity kinds, for people (UI, validation messages, scenario palette). */
import type { EntityKind, LinkKind } from "./blueprint";

export const KIND_LABELS: Readonly<Record<EntityKind, string>> = {
  site: "사업장",
  building: "건물",
  floor: "층",
  room: "서버룸",
  containment: "컨테인먼트",
  rack: "랙",
  server: "서버",
  switch: "스위치",
  storage: "스토리지",
  pdu: "PDU",
  cooling_unit: "냉방기",
  power_panel: "분전반",
  ups: "UPS",
  vcenter: "vCenter",
  cluster: "클러스터",
  vm: "VM",
  datastore: "데이터스토어",
};

export const LINK_LABELS: Readonly<Record<LinkKind, string>> = {
  power: "전원",
  network: "네트워크",
  cooling: "냉방",
  runs_on: "호스트",
  member_of: "클러스터 소속",
  managed_by: "관리",
  stored_on: "저장소",
  backed_by: "스토리지 백엔드",
};

/** "냉방기·분전반" style list of kind labels; "link" (a network link target) reads as "네트워크 링크". */
export function kindList(kinds: readonly (EntityKind | "link")[]): string {
  return kinds.map((k) => (k === "link" ? "네트워크 링크" : KIND_LABELS[k])).join("·");
}
