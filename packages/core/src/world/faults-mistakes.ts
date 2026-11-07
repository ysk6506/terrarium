import type { FaultSpec, MistakeType } from "./faults";
import { SDN_MISTAKE_SPEC } from "./faults-sdn";

/** The mistakes a scenario can make with its configuration blocks, named so a diagnosis can name them. */
export const MISTAKE_SPECS: ReadonlyArray<
  Omit<FaultSpec, "type"> & { readonly type: MistakeType }
> = [
  {
    type: "port_vlan_mismatch",
    label: "포트 VLAN 오설정",
    description: "서버가 꽂힌 스위치 포트가 다른 VLAN에 들어 있어요",
    targets: ["switch"],
    params: [],
    status: "supported",
    domain: "network",
  },
  {
    type: "port_shutdown",
    label: "포트 꺼짐",
    description: "스위치 포트를 관리자가 꺼 두었어요(shutdown)",
    targets: ["switch"],
    params: [],
    status: "supported",
    domain: "network",
  },
  {
    type: "svi_shutdown",
    label: "VLAN 인터페이스 꺼짐",
    description: "게이트웨이 역할을 하는 VLAN 인터페이스(SVI)가 꺼져 있어요",
    targets: ["switch"],
    params: [],
    status: "supported",
    domain: "network",
  },
  {
    type: "bgp_neighbor_shutdown",
    label: "BGP 이웃 꺼짐",
    description: "스위치가 BGP 이웃 하나를 꺼 두어 그 길로 배운 경로가 사라졌어요",
    targets: ["switch"],
    params: [],
    status: "supported",
    domain: "network",
  },
  {
    type: "route_missing",
    label: "경로 지워짐",
    description: "스위치에서 정적 경로 하나가 지워져 그쪽으로 가는 길을 잃었어요",
    targets: ["switch"],
    params: [],
    status: "supported",
    domain: "network",
  },
  {
    type: "outlet_off",
    label: "PDU 콘센트 꺼짐",
    description: "PDU의 콘센트 하나를 꺼 두어 거기 꽂힌 장비가 전원을 잃었어요",
    targets: ["pdu"],
    params: [],
    status: "supported",
    domain: "facility",
  },
  SDN_MISTAKE_SPEC,
];
