/**
 * The eight faults of the container layer (REQ-096, ADR-0107 item 6). Physics moves the state along with them
 * (physics/k8s.ts), the services that lean on a workload feel it (k8s-health.ts), and the table in
 * docs/design-docs/container-layer.md says how each one ends. A VM or host that fails also makes its node NotReady,
 * without a fault of its own: the node reads the machine under it.
 */
import type { FaultParamSpec, FaultSpec } from "./faults";

const p = (
  name: string,
  label: string,
  min: number,
  max: number,
  def: number,
  unit: string,
): FaultParamSpec => ({ name, label, min, max, default: def, unit });

export const K8S_FAULT_SPECS: readonly FaultSpec[] = [
  {
    type: "k8s_node_notready",
    label: "워커 노드 NotReady",
    description:
      "노드의 kubelet이 멈춰 NotReady가 돼요(올라간 VM·호스트가 멈춰도 같은 모습이에요). 5분 뒤 클러스터가 파드를 다른 노드로 옮겨요. kubelet을 다시 시작하면 돌아와요",
    targets: ["k8s_node"],
    params: [],
    status: "supported",
    domain: "os",
  },
  {
    type: "k8s_control_plane_down",
    label: "컨트롤 플레인 노드 다운",
    description:
      "컨트롤 플레인 노드 하나가 멈춰요. 하나뿐이면 API가 멈춰 새 배포·스케줄이 안 되고(돌던 파드는 그대로), 셋이면 하나를 잃어도 버텨요",
    targets: ["k8s_node"],
    params: [],
    status: "supported",
    domain: "os",
  },
  {
    type: "k8s_etcd_quorum_lost",
    label: "etcd 쿼럼 상실",
    description:
      "etcd 멤버가 과반 넘게 멈춰 클러스터 상태를 쓸 수 없어요. API가 멈춰 새 배포·스케줄·재스케줄이 모두 안 돼요. 돌던 파드는 그대로 돌아요. 복구는 컨트롤 플레인을 아는 팀이 해야 해요",
    targets: ["k8s_cluster"],
    params: [p("down", "멈춘 etcd 멤버 수", 1, 3, 2, "개")],
    status: "supported",
    domain: "os",
  },
  {
    type: "k8s_pod_crashloop",
    label: "파드 CrashLoopBackOff",
    description:
      "워크로드의 파드가 뜨자마자 죽기를 반복해요(잘못된 이미지·설정). 기다리는 시간이 10초부터 5분까지 두 배씩 늘어요. 고친 설정으로 롤아웃 재시작을 해야 돌아와요",
    targets: ["k8s_workload"],
    params: [p("variant", "원인(1 설정 오류, 2 이미지 오류)", 1, 2, 1, "")],
    status: "supported",
    domain: "os",
  },
  {
    type: "k8s_resource_exhausted",
    label: "자원 부족 (Pending)",
    description:
      "클러스터의 할당 가능한 CPU·메모리가 줄어(다른 팀이 쓰거나 예약이 늘어) 파드가 노드를 못 찾고 Pending으로 남아요. 덜 중요한 워크로드를 줄이거나 노드를 늘려야 해요",
    targets: ["k8s_cluster"],
    params: [p("lostPct", "줄어든 할당량", 10, 90, 50, "%")],
    status: "supported",
    domain: "os",
  },
  {
    type: "k8s_image_pull_failure",
    label: "이미지 풀 실패",
    description:
      "컨테이너 레지스트리에 닿지 않아 새로 뜨는 파드가 ImagePullBackOff에서 멈춰요. 이미 돌던 파드는 그대로예요. 레지스트리·네트워크를 아는 팀이 풀어야 해요",
    targets: ["k8s_cluster"],
    params: [],
    status: "supported",
    domain: "os",
  },
  {
    type: "k8s_disk_pressure",
    label: "kubelet 디스크 압박",
    description:
      "노드의 디스크가 가득 차 kubelet이 DiskPressure를 알리고 파드를 쫓아내요(Evicted). 노드는 스케줄이 막혀요. 디스크를 비우고 uncordon 해야 해요",
    targets: ["k8s_node"],
    params: [],
    status: "supported",
    domain: "os",
  },
  {
    type: "k8s_cni_failure",
    label: "네트워크 플러그인(CNI) 고장",
    description:
      "노드의 CNI가 죽어 그 노드의 파드끼리, 그리고 다른 노드 파드와 통신이 끊겨요. 노드는 Ready, 파드는 Running으로 보여서 알아채기 어려워요. 노드를 drain 하거나 containerd를 다시 시작해요",
    targets: ["k8s_node"],
    params: [],
    status: "supported",
    domain: "os",
  },
];
