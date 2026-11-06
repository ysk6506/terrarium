/**
 * The seven faults of the SDN overlay and cloud-native network layers (REQ-097, ADR-0107 item 6), and the one mistake
 * (a wrong network policy, which a scenario makes with a configuration block and an operator undoes). Physics moves the
 * state along with them (physics/sdn.ts), the services that lean on the overlay feel it (sdn-health.ts), and the table in
 * docs/design-docs/sdn-network-layer.md says how each is ended. All of them are the network team's.
 */
import type { FaultParamSpec, FaultSpec, MistakeType } from "./faults";

const p = (
  name: string,
  label: string,
  min: number,
  max: number,
  def: number,
  unit: string,
): FaultParamSpec => ({ name, label, min, max, default: def, unit });

export const SDN_FAULT_SPECS: readonly FaultSpec[] = [
  {
    type: "sdn_controller_down",
    label: "SDN 컨트롤러 다운",
    description:
      "SDN 컨트롤러가 멈췄어요. 이미 깔린 흐름은 그대로 흐르고 새 설정만 못 밀어요. 스탠바이가 있으면 30초쯤 뒤에 이어받아요",
    targets: ["sdn_controller"],
    params: [],
    status: "supported",
    domain: "network",
  },
  {
    type: "sdn_sync_failed",
    label: "컨트롤러 설정 동기화 실패",
    description:
      "컨트롤러가 밀어 준 설정이 스위치 한 대에 닿지 못해 옛 설정이 남았어요. 그 VTEP 뒤 서버들은 세그먼트에서 빠져요. 다시 동기화하면 돌아와요",
    targets: ["vtep"],
    params: [],
    status: "supported",
    domain: "network",
  },
  {
    type: "vxlan_tunnel_down",
    label: "VXLAN 터널 끊김",
    description:
      "VTEP 사이의 underlay 경로가 막혀(업링크 포트가 막힘) 그 VTEP로 가는 터널이 모두 내려가요. 스위치 포트는 네트워크 팀이 살려요",
    targets: ["vtep"],
    params: [],
    status: "supported",
    domain: "network",
  },
  {
    type: "evpn_session_flap",
    label: "EVPN 세션 플랩",
    description:
      "EVPN 세션이 올라왔다 내려갔다를 되풀이해요. 내려가 있는 동안 그 VTEP 뒤 서버들이 고립돼요. 다시 동기화하면 멈춰요",
    targets: ["vtep"],
    params: [p("periodS", "한 번 오르내리는 주기", 20, 600, 120, "초")],
    status: "supported",
    domain: "network",
  },
  {
    type: "ingress_controller_down",
    label: "인그레스 컨트롤러 다운",
    description:
      "서비스로 들어오는 문(인그레스)이 닫혀 밖에서 오는 요청만 막혀요. 클러스터 안의 호출은 그대로예요. 다시 시작하면 돌아와요",
    targets: ["ingress"],
    params: [],
    status: "supported",
    domain: "network",
  },
  {
    type: "cni_plugin_failure",
    label: "CNI 플러그인 고장",
    description:
      "노드 한 대의 CNI 플러그인이 죽어 그 노드의 파드가 다른 곳과 통신하지 못해요. 노드에서 플러그인을 다시 시작하면 돌아와요",
    targets: ["cni"],
    params: [],
    status: "supported",
    domain: "network",
  },
  {
    type: "nfv_firewall_overload",
    label: "가상 방화벽 과부하",
    description:
      "경로에 선 가상 방화벽이 처리 한계에 닿아 지연이 크게 늘어요. 서비스는 느려지고, 용량을 늘리는 것은 네트워크 팀의 일이에요",
    targets: ["nfv_function"],
    params: [p("loadPct", "부하", 80, 400, 180, "%")],
    status: "supported",
    domain: "network",
  },
];

/** The mistake: a policy deployed with the wrong rule (a deny that cuts services off each other). */
export const SDN_MISTAKE_SPEC: Omit<FaultSpec, "type"> & { readonly type: MistakeType } = {
  type: "network_policy_deny",
  label: "잘못된 네트워크 정책 배포",
  description: "네트워크 정책 하나가 차단(deny)으로 배포되어 서비스 사이의 호출이 끊겼어요",
  targets: ["network_policy"],
  params: [],
  status: "supported",
  domain: "network",
};
