/** Cards of the storage, database and application ladders (ADR-0107 item 3). */
import { problemName } from "@terrarium/core/scenario";
import { chipById } from "@terrarium/core/world";
import { type ChipCard, rows } from "./card-types";

/** The faults a modelled choice has, named as the core names them: what it stops, then what it only slows (REQ-095). */
export function faultsOf(id: string): string {
  const chip = chipById(id);
  return chip ? [...chip.stops, ...chip.slows].map(problemName).join(" · ") : "";
}

export const STORAGE_CARDS: readonly ChipCard[] = [
  {
    id: "sto-local",
    layer: "storage",
    label: "로컬 디스크",
    what: "데이터가 서버 안의 디스크에 있어요. 가장 단순하고 빠르지만, 디스크가 죽으면 그 서버의 데이터가 사라져요.",
    canLose: "아무것도",
    mustNot: "디스크 — 그 서버의 데이터가 사라져요",
    faults: "디스크 고장 · 디스크 가득 · 파일시스템 읽기 전용",
    cost: "서버 값에 들어 있어요",
    result: "디스크 하나가 죽으면 그 서버의 데이터가 사라져요",
    diagram: rows(
      "서버 안의 디스크 하나가 끊김",
      [
        ["서버", 1],
        ["디스크", 1, "one"],
      ],
      [1, 0],
    ),
  },
  {
    id: "sto-raid-backup",
    layer: "storage",
    label: "로컬 RAID + 백업",
    what: "서버 안에서 디스크를 묶어 하나쯤 죽어도 버티고, 밤마다 백업을 따로 떠 둬요. 서버째 잃어도 백업에서 되살릴 수 있어요.",
    canLose: "디스크 하나 · 서버 하나 (백업에서 되살림)",
    mustNot: "백업과 원본이 함께",
    faults: "디스크 가득 · 파일시스템 읽기 전용 · 복구 지연",
    cost: "디스크 두 배 + 백업 저장소",
    result: "디스크 하나는 잃어도 돼요 · 서버째 잃으면 백업에서 되살려요",
    diagram: rows(
      "서버의 디스크 넷이 묶여 있고 디스크 하나가 끊기며 백업 저장소가 따로 있음",
      [
        ["서버", 1],
        ["RAID 디스크", 4, "mesh"],
        ["백업", 1, "bus"],
      ],
      [1, 1],
    ),
  },
  {
    id: "sto-shared",
    layer: "storage",
    label: "공유 SAN·NAS",
    what: "여러 호스트가 어레이 하나의 데이터를 같이 써요. VM을 호스트 사이로 옮기려면 있어야 해요. 컨트롤러가 둘이지만 호스트가 길을 알아서 못 바꿔서, 쓰던 길이 끊기면 사람이 다른 길로 바꿔 줘야 이어져요.",
    canLose: "디스크 몇 개 (RAID) · 컨트롤러 하나 (사람이 길을 바꾸면)",
    mustNot: "길을 바꿔 줄 사람 — 바꾸기 전까지 이 어레이를 쓰는 데이터베이스가 멈춰요",
    faults: faultsOf("sto-shared"),
    cost: "어레이 1대 · 2,500만 원쯤",
    result: "쓰던 길이 끊기면 사람이 다른 컨트롤러 길로 바꿔야 이어져요",
    diagram: rows(
      "호스트 셋이 컨트롤러 둘 가운데 하나로만 이어지고 쓰던 컨트롤러가 끊김",
      [
        ["호스트", 3],
        ["컨트롤러", 2, "mesh"],
        ["디스크", 4, "mesh"],
      ],
      [1, 0],
    ),
  },
  {
    id: "sto-dual-controller",
    layer: "storage",
    label: "듀얼 컨트롤러 + 멀티패스",
    what: "어레이에 컨트롤러가 둘이고 호스트가 길을 둘로 이어요. 한쪽이 멈추면 다른 길로 같은 데이터를 읽어요.",
    canLose: "컨트롤러 하나 · 경로 하나",
    mustNot: "어레이 전체 · 두 컨트롤러가 함께",
    faults: faultsOf("sto-dual-controller"),
    cost: "어레이 3,500만 원쯤 · 호스트에 HBA",
    result: "컨트롤러 하나가 죽어도 호스트가 알아서 다른 길로 바꿔요 · 잠깐 느려요",
    diagram: rows(
      "호스트 둘이 컨트롤러 둘로 이어지고 컨트롤러 하나가 끊김",
      [
        ["호스트", 2],
        ["컨트롤러", 2, "mesh"],
        ["디스크", 4, "mesh"],
      ],
      [1, 0],
    ),
  },
  {
    id: "sto-distributed",
    layer: "storage",
    label: "분산 스토리지(3벌)",
    what: "데이터를 노드 세 곳에 나눠 세 벌씩 두고, 한 곳이 더 있어서 노드를 잃으면 남은 두 벌에서 다시 세 벌로 채워요. 채우는 동안은 느려요.",
    canLose: "노드 하나 (두 벌 남음)",
    mustNot: "노드 둘이 동시에 — 복제본이 한 벌이면 쓰기가 막혀요",
    faults: faultsOf("sto-distributed"),
    cost: "노드 3대 이상 · 용량은 3배 필요",
    result: "노드 하나를 잃어도 이어가요 · 복제본을 다시 만드는 동안 느려요",
    diagram: rows(
      "노드 셋이 서로 이어져 같은 데이터를 세 벌 갖고 노드 하나가 끊김",
      [
        ["노드", 3],
        ["디스크", 3, "one"],
      ],
      [0, 2],
    ),
  },
  {
    id: "sto-geo",
    layer: "storage",
    label: "지역 복제",
    what: "다른 사이트에 데이터를 따로 복제해 둬요. 사이트가 통째로 사라져도 다른 쪽에 데이터가 있어요. 복제가 조금 늦을 수 있어요.",
    canLose: "사이트 하나 통째",
    mustNot: "복제가 밀린 만큼의 최신 데이터",
    faults: faultsOf("sto-geo"),
    cost: "다른 사이트의 어레이와 회선 · 1.5억 원쯤",
    result: "다른 사이트에 한 벌 더 있어요 · 복제가 밀린 만큼은 잃을 수 있어요",
    diagram: rows(
      "사이트 둘의 어레이가 복제로 이어지고 한쪽이 끊김",
      [
        ["어레이", 2, "bus"],
        ["디스크", 4, "mesh"],
      ],
      [0, 0],
    ),
  },
];

export const DATABASE_CARDS: readonly ChipCard[] = [
  {
    id: "db-single",
    layer: "database",
    label: "단일 인스턴스 + 백업",
    what: "데이터베이스 한 대에 밤마다 백업을 떠요. 죽으면 백업에서 되살리는 동안 멈춰요. 마지막 백업 뒤에 쓴 데이터는 사라져요.",
    canLose: "아무것도 · 백업 이후 데이터는 잃어요",
    mustNot: "그 한 대",
    faults: faultsOf("db-single"),
    cost: "서버 한 대 + 백업",
    result: "한 대가 죽으면 백업에서 되살릴 때까지 멈춰요",
    diagram: rows(
      "데이터베이스 한 대와 백업, 데이터베이스가 끊김",
      [
        ["DB", 1],
        ["백업", 1, "one"],
      ],
      [0, 0],
    ),
  },
  {
    id: "db-active-passive",
    layer: "database",
    label: "액티브-패시브 클러스터",
    what: "DB 둘이 같은 디스크를 두고 하나만 일해요. 일하는 쪽이 멈추면 쉬던 쪽이 디스크를 넘겨받아 이어서 일해요. 몇 분 멈춰요.",
    canLose: "DB 한 대",
    mustNot: "공유 디스크 — 둘 다 멈춰요",
    faults: faultsOf("db-active-passive"),
    cost: "서버 두 대 + 공유 스토리지",
    result: "DB가 둘이라 하나가 죽으면 쉬던 쪽이 이어받아요",
    diagram: rows(
      "DB 둘이 공유 디스크 하나를 두고 일하는 쪽이 끊김",
      [
        ["DB", 2],
        ["공유 디스크", 1, "mesh"],
      ],
      [0, 0],
    ),
  },
  {
    id: "db-shared-aa",
    layer: "database",
    label: "공유 디스크 액티브-액티브",
    what: "DB 여럿이 같은 디스크를 두고 동시에 일해요. 하나가 죽어도 나머지가 계속 받아서 멈춤이 거의 없어요. 디스크가 한 곳이라는 점은 그대로예요.",
    canLose: "DB 노드 하나",
    mustNot: "공유 디스크",
    faults: faultsOf("db-shared-aa"),
    cost: "서버 셋 + 전용 클러스터 라이선스",
    result: "노드 하나가 죽어도 나머지가 받아요. 공유 디스크는 그대로 한 곳이에요",
    diagram: rows(
      "DB 셋이 공유 디스크 하나를 같이 쓰고 DB 하나가 끊김",
      [
        ["DB", 3],
        ["공유 디스크", 1, "mesh"],
      ],
      [0, 1],
    ),
  },
  {
    id: "db-primary-secondary",
    layer: "database",
    label: "프라이머리-세컨더리 복제",
    what: "프라이머리에 쓰면 세컨더리가 따라 복제해요. 프라이머리가 죽으면 사람이 세컨더리를 승격시켜요. 복제가 늦으면 그만큼 잃어요.",
    canLose: "프라이머리 (승격하면)",
    mustNot: "승격을 못 하는 상황 · 복제 지연만큼의 최신 데이터",
    faults: faultsOf("db-primary-secondary"),
    cost: "서버 두 대 · 디스크 각각",
    result: "프라이머리가 죽으면 사람이 승격시켜야 해요",
    diagram: rows(
      "프라이머리가 세컨더리로 복제하고 프라이머리가 끊김",
      [
        ["프라이머리", 1],
        ["세컨더리", 1, "mesh"],
      ],
      [0, 0],
    ),
  },
  {
    id: "db-auto-failover",
    layer: "database",
    label: "자동 페일오버·다중 복제",
    what: "복제본이 여럿이고, 감시자가 프라이머리의 죽음을 알아채면 가장 최신 복제본을 스스로 승격해요. 사람 손 없이 몇십 초 안에 이어져요.",
    canLose: "프라이머리 · 복제본 하나",
    mustNot: "감시자 과반 · 복제본 전부",
    faults: faultsOf("db-auto-failover"),
    cost: "서버 셋 + 감시자",
    result: "프라이머리가 죽어도 스스로 승격해서 이어가요",
    diagram: rows(
      "감시자가 프라이머리와 복제본 둘을 지켜보고 프라이머리가 끊김",
      [
        ["감시자", 1],
        ["DB", 3, "mesh"],
      ],
      [1, 0],
    ),
  },
  {
    id: "db-distributed-sql",
    layer: "database",
    label: "분산 SQL·합의",
    what: "노드 셋 이상이 투표로 리더를 뽑고 쓰기는 과반이 받아야 확정돼요(Raft). 노드 하나를 잃으면 새 리더를 뽑는 몇 초 동안 쓰기가 멈칫하고, 과반을 잃으면 쓰기가 멈춰요.",
    canLose: "노드 하나 (과반이 남으면, 리더면 몇 초 멈칫)",
    mustNot: "노드 과반이 동시에 · 노드를 둘 이상 한꺼번에 재시작",
    faults: faultsOf("db-distributed-sql"),
    cost: "서버 셋 이상 · 운영 난도 높음 · 8천만 원쯤",
    result: "노드 하나쯤은 잃어도 합의가 이어져요 · 리더를 잃으면 몇 초 멈칫해요",
    diagram: rows("노드 셋이 서로 이어져 합의하고 노드 하나가 끊김", [["노드", 3, "bus"]], [0, 2]),
  },
  {
    id: "db-managed-multiaz",
    layer: "database",
    label: "클라우드 관리형 멀티 AZ",
    what: "공급자가 DB를 여러 가용 영역(AZ)에 두고 알아서 운영해요. 호스트도 디스크도 못 보는 대신 영역 하나가 죽으면 공급자가 알아서 넘어가요. 우리가 하는 건 상태 보기, 수동 페일오버, 저장소 늘리기뿐이에요.",
    canLose: "가용 영역 하나 (넘어가는 동안 쓰기가 멈칫)",
    mustNot: "저장소 가득 · 영역 사이를 오가는 떨림",
    faults: faultsOf("db-managed-multiaz"),
    cost: "월 사용료 · 1.2억 원쯤",
    result: "공급자가 영역을 넘겨요 · 우리 손은 상태 보기와 저장소 늘리기뿐이에요",
    diagram: rows(
      "관리형 DB가 영역 둘에 걸쳐 있고 영역 하나가 끊김",
      [
        ["관리형 DB", 1],
        ["영역", 2, "mesh"],
      ],
      [1, 0],
    ),
  },
];

export const APP_CARDS: readonly ChipCard[] = [
  {
    id: "app-single",
    layer: "app",
    label: "프로세스 하나",
    what: "요청을 받는 프로세스가 하나예요. 가장 단순하지만 그게 멈추거나 인증서가 만료되면 서비스가 멈춰요.",
    canLose: "아무것도",
    mustNot: "그 프로세스",
    faults: "프로세스 반복 종료 · 메모리 누수 · 인증서 만료",
    cost: "서버 한 대",
    result: "프로세스 하나가 멈추면 서비스가 멈춰요",
    diagram: rows(
      "프로세스 하나가 요청을 받고 끊김",
      [
        ["요청", 1],
        ["프로세스", 1, "one"],
      ],
      [1, 0],
    ),
  },
  {
    id: "app-lb-sticky",
    layer: "app",
    label: "LB 뒤 N대(세션 있음)",
    what: "로드밸런서가 여러 대에 요청을 나눠요. 한 대가 죽어도 나머지가 받지만, 세션이 그 서버에 붙어 있어서 그 사람들은 다시 로그인해야 해요.",
    canLose: "서버 한 대 (그 서버의 세션은 잃어요)",
    mustNot: "로드밸런서 · 인증서",
    faults: "프로세스 반복 종료 · 메모리 누수 · 로그 폭주 · 인증서 만료",
    cost: "서버 N대 + LB",
    result: "한 대는 잃어도 돼요 · 그 서버의 세션은 사라져요",
    diagram: rows(
      "로드밸런서 뒤에 서버 셋이 있고 서버 하나가 끊김",
      [
        ["LB", 1],
        ["서버", 3, "mesh"],
      ],
      [1, 1],
    ),
  },
  {
    id: "app-stateless",
    layer: "app",
    label: "무상태 N대 + 외부 세션",
    what: "세션을 서버가 아닌 바깥 저장소(redis)에 둬요. 어느 서버가 죽어도 사람들은 로그인한 채 다른 서버로 이어져요. 로드 밸런서는 헬스 체크가 3번 실패한 서버를 스스로 빼요.",
    canLose: "서버 여러 대 (사람들은 로그인한 채 이어져요)",
    mustNot: "세션 저장소 — 멈추면 모두 로그인이 풀려요 · 로드 밸런서 · 인증서",
    faults: faultsOf("app-stateless"),
    cost: "서버 N대 + 로드 밸런서 + 세션 저장소 · 1천만 원쯤",
    result:
      "서버 한 대 고장은 로드 밸런서가 알아서 빼요 · 세션 저장소가 멈추면 로그인이 풀려 느려져요",
    diagram: rows(
      "로드 밸런서 뒤 서버 셋이 세션 저장소를 함께 쓰고 서버 하나가 끊김",
      [
        ["LB", 1],
        ["서버", 3, "mesh"],
        ["세션", 1, "mesh"],
      ],
      [1, 2],
    ),
  },
  {
    id: "app-microservices",
    layer: "app",
    label: "마이크로서비스 + 서킷 브레이커",
    what: "기능마다 작은 서비스로 쪼개고 서로 불러요. 부르는 쪽에 서킷 브레이커를 달아, 상대가 멈추면 부르는 쪽이 멈추는 대신 대체 응답으로 버티고 상대가 돌아오면 스스로 닫혀요.",
    canLose: "작은 서비스 하나 (부르는 쪽은 느려질 뿐 멈추지 않아요)",
    mustNot: "서킷 브레이커가 열린 채 굳는 일 · 게이트웨이 · 공통 인증",
    faults: faultsOf("app-microservices"),
    cost: "서비스 수만큼 + 호출마다 브레이커 · 2천만 원쯤",
    result:
      "부르는 서비스는 상대가 멈춰도 느려질 뿐이에요 · 브레이커가 굳으면 상대가 멀쩡해도 대체 응답만 받아요",
    diagram: rows(
      "게이트웨이 아래 작은 서비스 넷이 있고 서비스 하나가 끊김",
      [
        ["게이트웨이", 1],
        ["서비스", 4, "mesh"],
      ],
      [1, 2],
    ),
  },
  {
    id: "app-mesh",
    layer: "app",
    label: "서비스 메시 + 사이드카",
    what: "서비스 옆마다 사이드카 프록시를 두고, 컨트롤 플레인이 재시도·암호화 설정을 한꺼번에 밀어요. 설정 한 번이 모두에게 닿는 만큼 잘못 밀면 모두가 같이 흔들려요.",
    canLose: "사이드카 하나 · 컨트롤 플레인 잠깐 (이미 깔린 트래픽은 그대로 흘러요)",
    mustNot:
      "잘못된 재시도 설정 — 호출이 몇 배로 불어요 · 컨트롤 플레인이 멈춘 채 설정을 되돌리는 일",
    faults: faultsOf("app-mesh"),
    cost: "사이드카 자원 + 컨트롤 플레인 · 4천만 원쯤 · 운영 난도 높음",
    result: "재시도 폭주는 설정을 되돌려야 멈춰요 · 컨트롤 플레인이 멈추면 되돌리기도 거부돼요",
    diagram: rows(
      "메시 컨트롤 아래 사이드카를 낀 서비스 셋이 있고 사이드카 하나가 끊김",
      [
        ["메시 컨트롤", 1],
        ["서비스", 3, "mesh"],
      ],
      [1, 0],
    ),
  },
  {
    id: "app-multiregion",
    layer: "app",
    label: "멀티 리전 액티브-액티브",
    what: "리전 둘이 동시에 요청을 받아요. 한 리전이 통째로 멈추면 글로벌 로드 밸런서가 5분 뒤에 알아채 빼고, 사람이 먼저 트래픽을 옮기면 기다리지 않아도 돼요. 리전 사이 복제가 밀리면 옛 값이 읽혀요.",
    canLose: "리전 하나 통째 (그 리전의 세션은 사라져요)",
    mustNot: "리전 사이 복제 지연 — 옛 값을 읽어요 · 두 리전이 함께 멈추는 일",
    faults: faultsOf("app-multiregion"),
    cost: "리전 수만큼 두 배 이상 · 1억 5천만 원쯤",
    result: "리전이 멈추면 5분은 일부가 실패해요 · 사람이 바로 옮기면 로그인만 다시 하면 돼요",
    diagram: rows(
      "전역 분배기 아래 리전 둘이 있고 리전 하나가 끊김",
      [
        ["전역 분배", 1],
        ["리전", 2, "mesh"],
        ["서버", 4, "mesh"],
      ],
      [1, 0],
    ),
  },
];
