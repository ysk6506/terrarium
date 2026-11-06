/** Korean names of entity kinds, for people (UI, validation messages, scenario palette). */
import type { EntityKind, LinkKind } from "./blueprint";

export const KIND_LABELS: Readonly<Record<EntityKind, string>> = {
  site: "사업장",
  parcel: "부지",
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
  cdu: "CDU(냉각수 분배)",
  chiller: "냉각 플랜트",
  generator: "발전기",
  vcenter: "vCenter",
  cluster: "클러스터",
  vm: "VM",
  datastore: "데이터스토어",
  service: "서비스",
  db_cluster: "데이터베이스 클러스터",
  db_instance: "데이터베이스 인스턴스",
  storage_pool: "스토리지 풀",
  storage_controller: "스토리지 컨트롤러",
  k8s_cluster: "쿠버네티스 클러스터",
  k8s_node: "쿠버네티스 노드",
  k8s_workload: "워크로드",
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
  service_on: "서비스가 도는 곳",
  service_via: "서비스 경로",
  depends_on: "기대는 곳",
  hosted_on: "올라간 곳",
};

/** "냉방기·분전반" style list of kind labels; "link" (a network link target) reads as "네트워크 링크". */
export function kindList(kinds: readonly (EntityKind | "link")[]): string {
  return kinds.map((k) => (k === "link" ? "네트워크 링크" : KIND_LABELS[k])).join("·");
}
