/** Cards of the network and compute ladders (ADR-0107 item 3). */
import { type ChipCard, rows } from "./card-types";
import { faultsOf } from "./cards-data";

export const NETWORK_CARDS: readonly ChipCard[] = [
  {
    id: "net-legacy",
    layer: "network",
    label: "레거시 계층형",
    what: "코어 하나에 접속 스위치가 줄줄이 매달린 나무 모양이에요. 길이 하나뿐이라 단순하고 싸지만, 위가 끊기면 아래가 다 끊겨요.",
    canLose: "서버 쪽 포트 하나",
    mustNot: "코어 스위치 — 서버룸 전체가 끊겨요",
    faults: "코어 다운 · 링크 끊김 · 루프(STP)",
    cost: "스위치 가장 적게 · 랙당 2,000만 원쯤",
    result: "코어가 하나라 그게 멈추면 서버룸이 통째로 끊겨요",
    diagram: rows(
      "코어 하나 아래에 접속 스위치 넷이 매달린 나무 모양, 코어가 끊김",
      [
        ["코어", 1],
        ["접속", 4, "mesh"],
        ["서버", 4, "one"],
      ],
      [0, 0],
    ),
  },
  {
    id: "net-three-tier",
    layer: "network",
    label: "3티어 + 이중화",
    what: "코어·분배·접속 세 단이고, 코어와 분배는 둘씩이에요. 위쪽 하나쯤은 잃어도 돌아가요. 대신 접속 스위치 하나는 여전히 그 랙의 목숨줄이에요.",
    canLose: "코어 하나 · 분배 하나",
    mustNot: "접속 스위치 — 그 랙 서버가 다 끊겨요",
    faults: "분배 다운 · 링크 끊김 · VLAN 잘못 · 포트 닫힘",
    cost: "스위치 7대쯤 · 랙당 2,200만 원",
    result: "위쪽은 둘씩이라 하나는 잃어도 돼요",
    diagram: rows(
      "코어 둘, 분배 둘, 접속 넷의 세 단 구조에서 분배 하나가 끊김",
      [
        ["코어", 2],
        ["분배", 2, "mesh"],
        ["접속", 4, "mesh"],
      ],
      [1, 0],
    ),
  },
  {
    id: "net-leaf-spine",
    layer: "network",
    label: "리프-스파인(Clos)",
    what: "리프(랙 스위치)와 스파인이 전부 서로 이어져 있어요. 어느 서버에서 어느 서버로 가든 두 홉이고, 길이 여럿이라 트래픽이 나뉘어요(ECMP).",
    canLose: "스파인 하나 · 리프-스파인 링크 하나",
    mustNot: "리프 — 그 랙 서버가 다 끊겨요",
    faults: "링크 끊김 · 스파인 다운 · 리프 다운 · ECMP 불균형",
    cost: "스위치 6대 · 리프당 2,400만 원",
    result: "ECMP · 경로 여럿, 스파인 하나는 잃어도 돼요",
    diagram: rows(
      "스파인 둘과 리프 넷이 모두 이어진 구조에서 스파인 하나가 끊김",
      [
        ["스파인", 2],
        ["리프", 4, "mesh"],
        ["서버", 4, "one"],
      ],
      [0, 1],
    ),
  },
  {
    id: "net-sdn",
    layer: "network",
    label: "SDN 오버레이(VXLAN·EVPN)",
    what: "리프-스파인 위에 VXLAN 터널로 서비스마다 가상 네트워크(세그먼트)를 덮어요. 컨트롤러 둘(하나는 대기)이 설정을 밀고, 리프마다 있는 VTEP이 EVPN으로 서로를 찾아요. 컨트롤러가 멈춰도 돌던 길은 그대로 돌아요.",
    canLose: "컨트롤러 하나 (대기가 30초 뒤 이어받아요) · 스파인 링크 하나",
    mustNot: "리프의 업링크 전부 — 그 VTEP 뒤 서버가 세그먼트에서 빠져요",
    faults: faultsOf("net-sdn"),
    cost: "리프-스파인 + 컨트롤러 2대 + 가상 방화벽 · 1억 5천만 원쯤",
    result:
      "컨트롤러가 멈춰도 돌던 길은 돌고 대기가 이어받아요 · VTEP이 끊기면 그 뒤 서버만 세그먼트에서 빠져요",
    diagram: rows(
      "컨트롤러 둘이 리프의 VTEP 넷을 관리하고 컨트롤러 하나가 끊김",
      [
        ["컨트롤러", 2],
        ["VTEP", 4, "mesh"],
        ["서버", 4, "one"],
      ],
      [0, 0],
    ),
  },
  {
    id: "net-cloud-native",
    layer: "network",
    label: "클라우드 네이티브(CNI·인그레스)",
    what: "SDN 오버레이 위에 노드마다 CNI 플러그인이 파드 네트워크를 만들고, 네트워크 정책이 서비스 사이의 호출을 허용하거나 막고, 인그레스가 밖에서 들어오는 문이 돼요.",
    canLose: "노드 하나의 CNI (그 노드의 파드만) · 컨트롤러 하나",
    mustNot: "인그레스 — 밖에서 오는 요청이 막혀요 · 잘못 배포한 정책 하나가 서비스 사이를 끊어요",
    faults: faultsOf("net-cloud-native"),
    cost: "SDN 오버레이 + 노드마다 플러그인·정책·인그레스 · 1억 5천만 원쯤",
    result: "문이 닫히면 밖에서만 막히고 안은 멀쩡해요 · 정책이 잘못되면 그 서비스 사이만 끊겨요",
    diagram: rows(
      "인그레스 하나 아래 서비스 셋이 있고 인그레스가 끊김",
      [
        ["인그레스", 1],
        ["서비스", 3, "mesh"],
        ["노드", 3, "one"],
      ],
      [0, 0],
    ),
  },
  {
    id: "net-ai-fabric",
    layer: "network",
    label: "AI 패브릭·자율 네트워크",
    what: "GPU 서버끼리 800G급 선로로 촘촘히 잇고, 정체나 끊김을 네트워크가 스스로 알아채 길을 바꿔요. 가장 비싸지만 끊김에 가장 강해요.",
    canLose: "스파인 둘 · 링크 여럿",
    mustNot: "패브릭 컨트롤 — 자동 우회가 꺼져요",
    faults: "링크 끊김 · BGP 이웃 닫힘 · 경로 사라짐 · 스파인 다운",
    cost: "스위치 8대쯤 · 리프당 6,000만 원",
    result: "스파인이 여럿이라 여러 개를 잃어도 길이 남아요",
    diagram: rows(
      "스파인 넷과 리프 넷이 모두 이어져 있고 스파인 하나가 끊김",
      [
        ["스파인", 4],
        ["리프", 4, "mesh"],
        ["서버", 4, "one"],
      ],
      [0, 2],
    ),
  },
];

export const COMPUTE_CARDS: readonly ChipCard[] = [
  {
    id: "cmp-bare",
    layer: "compute",
    label: "베어메탈 한 대",
    what: "서비스가 서버 한 대 위에서 그대로 돌아요. 가상화가 없어서 가장 빠르고 단순하지만, 서버가 멈추면 서비스도 멈춰요.",
    canLose: "아무것도 — 서버 하나가 곧 서비스예요",
    mustNot: "그 서버 — 사람이 고칠 때까지 멈춰요",
    faults: "서버 정지 · 전원 장치 고장 · 디스크 고장 · 팬 고장",
    cost: "서버 노드 수만큼",
    result: "서버 하나가 멈추면 서비스도 멈춰요",
    diagram: rows(
      "서비스가 서버 한 대 위에서 돌고 서버가 끊김",
      [
        ["서비스", 1],
        ["서버", 1, "one"],
      ],
      [1, 0],
    ),
  },
  {
    id: "cmp-bare-spare",
    layer: "compute",
    label: "베어메탈 + 핫 스페어",
    what: "서버 옆에 늘 켜 둔 예비 서버 하나를 둬요. 멈추면 예비로 서비스를 옮겨요. 옮기는 건 사람이나 에이전트가 해야 해요.",
    canLose: "서버 하나 (예비로 옮기면)",
    mustNot: "예비까지 같이 — 같은 랙이면 같이 멈출 수 있어요",
    faults: "서버 정지 · 옮기기 실패 · 설정 어긋남",
    cost: "서버 한 대 더",
    result: "예비 서버가 한 대 켜져 있어요. 옮기는 건 사람이 해야 해요",
    diagram: rows(
      "서버 둘 가운데 활성 서버가 끊기고 예비가 남음",
      [
        ["서비스", 1],
        ["서버·예비", 2, "bus"],
      ],
      [1, 0],
    ),
  },
  {
    id: "cmp-virt-ha",
    layer: "compute",
    label: "가상화 클러스터(HA)",
    what: "호스트 여럿을 묶어 VM을 올려요. 호스트가 죽으면 그 위 VM이 다른 호스트에서 다시 떠요. 몇 분은 멈춰요.",
    canLose: "호스트 하나 (VM이 다시 떠요)",
    mustNot: "공유 스토리지 · vCenter 관리 — VM이 다시 못 떠요",
    faults: "호스트 다운 · VM CPU 폭주 · 메모리 누수 · 호스트 정지",
    cost: "호스트 3대 + 가상화 라이선스",
    result: "호스트 죽으면 VM이 다시 떠요 · 몇 분 멈춤",
    diagram: rows(
      "호스트 셋 위에 VM 아홉이 있고 호스트 하나가 끊김",
      [
        ["호스트", 3],
        ["VM", 9, "mesh"],
      ],
      [0, 1],
    ),
  },
  {
    id: "cmp-drs",
    layer: "compute",
    label: "가상화 + 자동 재배치(DRS)",
    what: "호스트가 바빠지면 VM을 알아서 다른 호스트로 옮겨 균형을 맞춰요. 느려지는 일이 줄지만 옮기는 동안 잠깐 흔들려요.",
    canLose: "호스트 하나 · 바쁜 호스트의 부담",
    mustNot: "공유 스토리지",
    faults:
      "커널 패닉 · BMC 무응답 · PSU 고장 · VM CPU 급증 · 메모리 누수 · CPU 폭주 · 서버 팬 고장",
    cost: "가상화 클러스터 + 상위 라이선스",
    result: "호스트가 바빠지면 VM을 알아서 옮겨요 · 옮기는 동안 잠깐 느려요",
    diagram: rows(
      "호스트 셋 사이로 VM이 옮겨 다니고 호스트 하나가 끊김",
      [
        ["호스트", 3],
        ["VM", 6, "mesh"],
      ],
      [0, 2],
    ),
  },
  {
    id: "cmp-containers",
    layer: "compute",
    label: "컨테이너 오케스트레이션",
    what: "VM 위에 쿠버네티스를 올려 파드를 알아서 옮겨요. 워커 하나쯤 잃어도 파드가 옆으로 가요. 컨트롤 플레인이 멈추면 새 배포가 막혀요.",
    canLose: "워커 노드 하나 · 파드",
    mustNot: "컨트롤 플레인 과반 · etcd",
    faults:
      "파드 CrashLoopBackOff · 워커 노드 NotReady · 컨트롤 플레인 노드 다운 · etcd 쿼럼 상실 · 자원 부족 (Pending) · 이미지 풀 실패 · kubelet 디스크 압박 · 네트워크 플러그인(CNI) 고장 · PSU 고장",
    cost: "컨트롤 플레인 3 + 워커 N",
    result:
      "워커를 잃으면 5분 뒤 파드가 옆 노드로 옮겨가요 · 컨트롤 플레인이 멈추면 새 배포만 막혀요",
    diagram: rows(
      "컨트롤 플레인 셋과 워커 여섯, 워커 하나가 끊김",
      [
        ["컨트롤", 3],
        ["워커", 6, "mesh"],
      ],
      [1, 4],
    ),
  },
  {
    id: "cmp-multicluster",
    layer: "compute",
    label: "멀티클러스터·서버리스",
    what: "클러스터를 둘 이상 두고 앞단에서 갈라 보내거나, 서버를 아예 보지 않고 함수로 돌려요. 한 클러스터가 통째로 죽어도 다른 쪽이 받아요.",
    canLose: "클러스터 하나 통째",
    mustNot: "앞단 분배기 · 공통 설정 저장소",
    faults:
      "파드 CrashLoopBackOff · 워커 노드 NotReady · 컨트롤 플레인 노드 다운 · etcd 쿼럼 상실 · 자원 부족 (Pending) · 이미지 풀 실패 · kubelet 디스크 압박 · 네트워크 플러그인(CNI) 고장",
    cost: "클러스터를 둘 이상 · 운영 비용 큼",
    result: "클러스터를 둘 지어요 · 한쪽이 통째로 멈춰도 서비스는 느려질 뿐이에요",
    diagram: rows(
      "분배기 아래 클러스터 둘, 클러스터 하나가 끊김",
      [
        ["분배기", 1],
        ["클러스터", 2, "mesh"],
        ["노드", 6, "mesh"],
      ],
      [1, 0],
    ),
  },
];
