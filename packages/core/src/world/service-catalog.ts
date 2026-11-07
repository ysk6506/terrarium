/**
 * The service catalog (REQ-104, ADR-0127): ten built-in cards with a fixed shape. A person picks a card and the
 * world gets a service of that shape; the only things they change afterwards are the name and, when they make an
 * experiment, the damage numbers. Nothing here is typed free-hand, so every card is one the generator can build.
 * The data is plain (no import from `sources`): `sources/worldgen/service-card.ts` turns a card into a draft.
 */
import type { LayerId } from "./ladder";
import type { ServiceKind } from "./service";
import type { WorkloadKind } from "./workload";

export interface CardPart {
  readonly label: string;
  readonly count?: number;
  /** 0 above, 1 in the middle, 2 below. */
  readonly tier: 0 | 1 | 2;
  readonly role?: "node" | "host" | "switch";
}

export interface CardStop {
  readonly what: string;
  readonly result: string;
  readonly bad?: boolean;
}

export interface CardTier {
  readonly name: string;
  readonly perHourKrw: number;
}

export interface CatalogCard {
  readonly id: string;
  readonly name: string;
  /** One line under the name, on the row and in the sheet. */
  readonly line: string;
  readonly gives: string;
  readonly stopsText: string;
  readonly kind: ServiceKind;
  readonly workload: WorkloadKind;
  /** Nodes (VMs, or servers when bare metal), hosts they spread over, and switches they stand behind. */
  readonly nodes: number;
  readonly hosts: number;
  readonly switches: number;
  readonly parts: readonly CardPart[];
  readonly stops: readonly CardStop[];
  /** Ways it can stop, with the default hourly damage of each (a guess: the person changes it when making an experiment). */
  readonly tiers: readonly CardTier[];
  /** Catalog cards it calls by default, when the world already has them. */
  readonly calls: readonly string[];
  /** The ladder layers that matter most for it; the second screen says so. */
  readonly matters: readonly LayerId[];
}

const part = (
  label: string,
  tier: 0 | 1 | 2,
  count?: number,
  role?: CardPart["role"],
): CardPart => ({
  label,
  tier,
  ...(count !== undefined ? { count } : {}),
  ...(role ? { role } : {}),
});

const hosts = (n: number) => part("가상화 호스트", 2, n, "host");
const switches = (n: number) => part("스위치", 2, n, "switch");

export const SERVICE_CATALOG: readonly CatalogCard[] = [
  {
    id: "web-api",
    name: "웹 API",
    line: "로드밸런서 뒤에서 요청에 답하는 서버 여럿",
    gives: "로드밸런서 뒤의 서버 여럿이 사람들의 요청에 답해요.",
    stopsText: "요청이 실패하고 화면이 안 열려요",
    kind: "request",
    workload: "api",
    nodes: 4,
    hosts: 3,
    switches: 2,
    parts: [part("로드밸런서", 0), part("API 서버 VM", 1, 4, "node"), hosts(3), switches(2)],
    stops: [
      { what: "API 서버 하나", result: "나머지가 받아요 · 잠깐 느림" },
      { what: "로드밸런서", result: "요청이 들어오지 못해요", bad: true },
    ],
    tiers: [
      { name: "일부 느림", perHourKrw: 500_000 },
      { name: "응답 없음", perHourKrw: 5_000_000 },
    ],
    calls: [],
    matters: ["compute", "network", "app"],
  },
  {
    id: "batch-pipeline",
    name: "배치 파이프라인",
    line: "밤에 모아서 도는 일, 멈추면 늦어져요",
    gives: "밤사이 쌓인 일을 모아 처리하고 아침까지 결과를 내요.",
    stopsText: "결과가 늦어지고 다음 일이 밀려요",
    kind: "batch",
    workload: "batch",
    nodes: 3,
    hosts: 2,
    switches: 2,
    parts: [
      part("스케줄러", 0),
      part("워커 VM", 1, 3, "node"),
      part("작업 저장소", 2),
      hosts(2),
      switches(2),
    ],
    stops: [
      { what: "워커 하나", result: "일이 길어져요" },
      { what: "스케줄러·저장소", result: "아침까지 결과가 안 나와요", bad: true },
    ],
    tiers: [
      { name: "늦어짐", perHourKrw: 300_000 },
      { name: "아침까지 못 끝남", perHourKrw: 2_000_000 },
    ],
    calls: [],
    matters: ["compute", "storage"],
  },
  {
    id: "app-db",
    name: "데이터베이스 뒤의 앱",
    line: "앱 서버가 데이터베이스에 기대는 상태 있는 서비스",
    gives: "앱 서버 둘이 데이터베이스 하나를 보고 일해요. 데이터가 곧 서비스예요.",
    stopsText: "앱이 답하지 못하고 쓰던 데이터가 위험해져요",
    kind: "stateful",
    workload: "interactive",
    nodes: 3,
    hosts: 3,
    switches: 2,
    parts: [
      part("앱 VM", 1, 2, "node"),
      part("데이터베이스 VM", 1, 1, "node"),
      hosts(3),
      part("공유 스토리지", 2),
      switches(2),
    ],
    stops: [
      { what: "앱 VM 하나", result: "나머지 하나가 받아요" },
      { what: "데이터베이스", result: "앱이 모두 멈춰요 · 복구까지 쓰기 불가", bad: true },
    ],
    tiers: [
      { name: "읽기만 됨", perHourKrw: 1_000_000 },
      { name: "데이터베이스 멈춤", perHourKrw: 8_000_000 },
    ],
    calls: [],
    matters: ["database", "storage", "compute"],
  },
  {
    id: "k8s-platform",
    name: "쿠버네티스 플랫폼",
    line: "VM 위 쿠버네티스에서 여러 팀의 앱이 돌아요",
    gives: "VM 위에 만든 쿠버네티스 클러스터 하나에 여러 앱이 올라가 있어요.",
    stopsText: "새 배포가 막히고 앱 일부가 답하지 못해요",
    kind: "request",
    workload: "interactive",
    nodes: 6,
    hosts: 3,
    switches: 2,
    parts: [
      part("플랫폼 앱", 0, 3),
      part("컨트롤 플레인 VM", 1, 3, "node"),
      part("워커 VM", 1, 3, "node"),
      hosts(3),
      part("공유 스토리지", 2),
      switches(2),
    ],
    stops: [
      { what: "워커 VM 하나", result: "파드가 옆으로 옮겨가요 · 잠깐 느림" },
      { what: "컨트롤 플레인", result: "새 배포가 멈춰요 · 돌던 파드는 돌아가요" },
      { what: "스토리지", result: "상태 있는 앱이 멈춰요", bad: true },
    ],
    tiers: [
      { name: "배포만 막힘", perHourKrw: 300_000 },
      { name: "앱 일부 응답 없음", perHourKrw: 2_000_000 },
      { name: "전부 멈춤", perHourKrw: 5_000_000 },
    ],
    calls: [],
    matters: ["compute", "network", "storage"],
  },
  {
    id: "message-queue",
    name: "메시지 큐",
    line: "서비스 사이에서 일을 전해 주고, 쌓이면 늦어져요",
    gives: "서비스들이 서로 보내는 일을 잠깐 쌓아 두었다가 순서대로 전해요.",
    stopsText: "메시지가 쌓이고 받는 쪽이 일을 못 받아요",
    kind: "stateful",
    workload: "stream",
    nodes: 3,
    hosts: 3,
    switches: 2,
    parts: [part("브로커 VM", 1, 3, "node"), part("디스크", 2), hosts(3), switches(2)],
    stops: [
      { what: "브로커 하나", result: "나머지가 받아요 · 잠깐 느림" },
      { what: "브로커 과반", result: "메시지를 받지 못해요 · 보내는 쪽이 막혀요", bad: true },
    ],
    tiers: [
      { name: "쌓임", perHourKrw: 800_000 },
      { name: "전달 중단", perHourKrw: 3_000_000 },
    ],
    calls: [],
    matters: ["compute", "storage"],
  },
  {
    id: "cache",
    name: "캐시",
    line: "없어도 돌지만 느려지는 빠른 저장소",
    gives: "자주 읽는 값을 메모리에 두어 뒤의 서비스를 가볍게 해요.",
    stopsText: "서비스는 돌지만 뒤쪽 데이터베이스가 버거워져 느려져요",
    kind: "request",
    workload: "api",
    nodes: 2,
    hosts: 2,
    switches: 2,
    parts: [part("캐시 VM", 1, 2, "node"), hosts(2), switches(2)],
    stops: [
      { what: "캐시 하나", result: "나머지가 받아요 · 적중률이 떨어져요" },
      { what: "캐시 둘 다", result: "뒤쪽 서비스가 느려져요" },
    ],
    tiers: [
      { name: "느려짐", perHourKrw: 400_000 },
      { name: "캐시 전체 멈춤", perHourKrw: 1_500_000 },
    ],
    calls: [],
    matters: ["compute", "network"],
  },
  {
    id: "ai-serving",
    name: "AI 추론 서빙",
    line: "GPU 서버가 모델로 요청에 답해요",
    gives: "로드밸런서 뒤의 GPU 서버가 모델을 올려 두고 요청에 답해요.",
    stopsText: "모델이 답하지 못해 기능이 멈춰요",
    kind: "request",
    workload: "api",
    nodes: 3,
    hosts: 3,
    switches: 2,
    parts: [part("로드밸런서", 0), part("GPU 서버", 1, 3, "node"), hosts(3), switches(2)],
    stops: [
      { what: "GPU 서버 하나", result: "나머지가 받아요 · 응답이 느려져요" },
      { what: "GPU 서버 모두", result: "모델이 답하지 못해요", bad: true },
    ],
    tiers: [
      { name: "응답 느림", perHourKrw: 1_000_000 },
      { name: "모델 응답 없음", perHourKrw: 6_000_000 },
    ],
    calls: ["cache"],
    matters: ["compute", "network", "cooling"],
  },
  {
    id: "training-pipeline",
    name: "학습 파이프라인",
    line: "GPU 여럿이 며칠 도는 학습, 체크포인트로 이어가요",
    gives: "GPU 클러스터가 오래 도는 학습을 하고 중간 결과를 저장소에 남겨요.",
    stopsText: "학습이 끊기고 마지막 체크포인트부터 다시 해야 해요",
    kind: "batch",
    workload: "batch",
    nodes: 4,
    hosts: 4,
    switches: 2,
    parts: [part("GPU 서버", 1, 4, "node"), part("체크포인트 저장소", 2), hosts(4), switches(2)],
    stops: [
      { what: "GPU 서버 하나", result: "학습이 멈추고 체크포인트부터 다시 해요" },
      { what: "저장소", result: "체크포인트를 잃어요 · 처음부터 다시", bad: true },
    ],
    tiers: [
      { name: "되감기", perHourKrw: 1_500_000 },
      { name: "체크포인트 손실", perHourKrw: 4_000_000 },
    ],
    calls: [],
    matters: ["compute", "storage", "power", "cooling"],
  },
  {
    id: "file-share",
    name: "파일 공유",
    line: "여럿이 같이 쓰는 NAS, 상태가 곧 서비스예요",
    gives: "팀 전체가 문서와 자료를 올리고 내려받는 공유 저장소예요.",
    stopsText: "파일을 열 수 없고 작업이 멈춰요",
    kind: "stateful",
    workload: "interactive",
    nodes: 2,
    hosts: 2,
    switches: 2,
    parts: [part("게이트웨이 VM", 1, 2, "node"), part("NAS", 2), hosts(2), switches(2)],
    stops: [
      { what: "게이트웨이 하나", result: "나머지가 받아요" },
      { what: "NAS", result: "모든 파일을 열 수 없어요", bad: true },
    ],
    tiers: [
      { name: "느림", perHourKrw: 300_000 },
      { name: "파일 열기 불가", perHourKrw: 2_500_000 },
    ],
    calls: [],
    matters: ["storage", "power"],
  },
  {
    id: "monitoring",
    name: "모니터링",
    line: "멈추면 다른 서비스의 알람이 안 와요",
    gives: "다른 서비스의 상태를 모아 보고 이상하면 알람을 보내요.",
    stopsText: "다른 서비스가 멈춰도 알람이 오지 않아요",
    kind: "stateful",
    workload: "stream",
    nodes: 2,
    hosts: 2,
    switches: 2,
    parts: [part("수집기·알람 VM", 1, 2, "node"), part("시계열 저장소", 2), hosts(2), switches(2)],
    stops: [
      { what: "수집기 하나", result: "나머지가 받아요" },
      { what: "수집기 둘 다", result: "알람이 오지 않아요 · 다른 고장을 늦게 알아요", bad: true },
    ],
    tiers: [
      { name: "알람 지연", perHourKrw: 200_000 },
      { name: "알람 중단", perHourKrw: 1_200_000 },
    ],
    calls: [],
    matters: ["compute", "storage"],
  },
];

export const catalogCard = (id: string): CatalogCard | undefined =>
  SERVICE_CATALOG.find((c) => c.id === id);
