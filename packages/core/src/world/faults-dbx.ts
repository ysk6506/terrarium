/**
 * The faults of the consensus database and the managed multi-AZ database (REQ-106, ADR-0129): a leader that dies, a ring
 * that loses its majority, a node that trails; a zone that fails, a failover that flaps, storage that fills. Physics
 * moves the state along with them (physics/dbx.ts) and the services feel it (dbx-health.ts).
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

export const DBX_FAULT_SPECS: readonly FaultSpec[] = [
  {
    type: "db_leader_lost",
    label: "합의 DB 리더 정지",
    description:
      "합의 DB의 리더 노드가 멈춰요. 남은 노드가 선거 제한 시간(10초) 뒤 새 리더를 뽑아 이어가요. 그동안 쓰기가 멈칫해요. 멈춘 노드는 다시 시작해 돌려놓아요",
    targets: ["db_node"],
    params: [],
    status: "supported",
    domain: "os",
  },
  {
    type: "db_quorum_lost",
    label: "합의 DB 과반 상실",
    description:
      "노드 과반이 한꺼번에 사라져요(네트워크 분할·정전). 리더를 뽑을 수 없어 쓰기가 모두 멈추고 읽기는 옛 값이에요. 멈춘 노드를 다시 시작해 과반을 되찾아요",
    targets: ["db_node"],
    params: [p("down", "함께 멈추는 노드 수", 2, 4, 2, "대")],
    status: "supported",
    domain: "os",
  },
  {
    type: "db_node_lagging",
    label: "합의 DB 노드 지연",
    description:
      "노드 하나가 로그를 따라가지 못하고 밀려요. 그 노드에서 읽으면 옛 값이 나와 서비스가 느려져요. 노드를 다시 시작하거나 리더를 다른 노드로 옮겨요",
    targets: ["db_node"],
    params: [p("lagS", "밀린 시간", 31, 3600, 120, "초")],
    status: "supported",
    domain: "os",
  },
  {
    type: "db_az_failure",
    label: "관리형 DB 가용 영역 정지",
    description:
      "가용 영역 하나가 멈춰요. 그 영역이 주인이면 공급자가 감지 뒤(30초) 다른 영역으로 넘기고 그동안 쓰기가 잠깐 멈춰요. 영역을 살리는 건 클라우드 공급자예요",
    targets: ["db_managed"],
    params: [p("az", "멈춘 영역(1부터)", 1, 3, 1, "번")],
    status: "supported",
    domain: "os",
  },
  {
    type: "db_failover_flapping",
    label: "관리형 DB 페일오버 반복",
    description:
      "관리형 DB가 영역 사이를 오락가락 넘어다녀요. 넘어갈 때마다 쓰기가 잠깐 멈춰요. 안정된 영역을 직접 골라 고정하면 멈춰요",
    targets: ["db_managed"],
    params: [],
    status: "supported",
    domain: "os",
  },
  {
    type: "db_storage_full",
    label: "관리형 DB 저장소 가득 참",
    description:
      "관리형 DB의 저장소가 가득 차 쓰기가 실패해요. 자동 확장은 10분쯤 뒤에 일어나요. 저장소를 직접 늘리면 바로 풀려요",
    targets: ["db_managed"],
    params: [],
    status: "supported",
    domain: "os",
  },
];
