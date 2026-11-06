/**
 * The words of the board that come from the core: what a folded tile is called, and the two sentences of the
 * impact box. Glossary rules: 해요체, Arabic numerals with units, "고장" and "알람", no "장애".
 */
import type { Impact } from "./impact";
import type { LayerId, TileClass, TopoKind } from "./types";

/** The impact range is one thing for the whole world; only the cooling layer can say what it means there. */
const IMPACT: Readonly<Record<LayerId, string>> = {
  cooling: "더워지는 중",
  power: "영향 범위",
  network: "영향 범위",
};

export function classLabel(cls: TileClass, layer: LayerId): string {
  switch (cls) {
    case "fault":
      return "고장";
    case "alarm":
      return "알람";
    case "touch":
      return "에이전트가 만지는";
    case "impact":
      return IMPACT[layer];
    default:
      return "정상";
  }
}

/** What to call a piece of equipment when counting it: the noun and the word for counting. */
const COUNTING: Readonly<Record<TopoKind, readonly [string, string]>> = {
  feed: ["변압기·전환 장치", "대"],
  generator: ["발전기", "대"],
  ups: ["UPS", "대"],
  panel: ["분전반", "개"],
  pdu: ["PDU", "개"],
  chiller: ["냉각 플랜트", "대"],
  cdu: ["CDU", "대"],
  crah: ["냉방기", "대"],
  room: ["서버룸", "곳"],
  rack: ["랙", "대"],
  server: ["서버", "대"],
  switch: ["스위치", "대"],
  storage: ["스토리지", "대"],
  vm: ["VM", "대"],
  cluster: ["클러스터", "개"],
  service: ["서비스", "개"],
  db_cluster: ["데이터베이스 클러스터", "개"],
  db_instance: ["DB 인스턴스", "개"],
  storage_pool: ["스토리지 풀", "개"],
  storage_controller: ["스토리지 컨트롤러", "개"],
  sdn_controller: ["SDN 컨트롤러", "개"],
  vtep: ["VTEP", "개"],
  overlay_segment: ["오버레이 세그먼트", "개"],
  nfv_function: ["가상 방화벽", "개"],
  cni: ["CNI 플러그인", "개"],
  network_policy: ["네트워크 정책", "개"],
  ingress: ["인그레스", "개"],
  k8s_cluster: ["쿠버네티스 클러스터", "개"],
  k8s_node: ["쿠버네티스 노드", "개"],
  k8s_workload: ["워크로드", "개"],
};

/** What a kind of equipment is called when counted ("랙", "냉방기"). */
export const nounOf = (kind: TopoKind): string => COUNTING[kind][0];

export const num = (n: number): string => n.toLocaleString("en-US");

/** "정상 랙 408대": the state first, then what and how many. */
export function groupName(
  cls: TileClass,
  layer: LayerId,
  kind: TopoKind | undefined,
  stage: string,
  count: number,
): string {
  const [noun, unit] = kind ? COUNTING[kind] : [stage, "개"];
  return `${classLabel(cls, layer)} ${noun} ${num(count)}${unit}`;
}

/** The first line of the impact box: how many rooms, racks and servers. */
export function impactCounts(impact: Impact): string {
  return `서버룸 ${num(impact.rooms.size)} · 랙 ${num(impact.racks.size)} · 서버 ${num(impact.servers)}`;
}

/**
 * The services line (ADR-0091): "서비스 3개 멈춤 · 설계 검증 큐 1,200건 대기". Empty when every service is fine.
 * Slow services are told after the stopped ones, then the work that piled up (the two largest queues).
 */
export function impactServices(impact: Impact): string {
  const s = impact.services;
  const parts = [
    ...(s.down > 0 ? [`서비스 ${num(s.down)}개 멈춤`] : []),
    ...(s.degraded > 0 ? [`${s.down > 0 ? "" : "서비스 "}${num(s.degraded)}개 느려짐`] : []),
    ...s.waiting.slice(0, 2).map((w) => `${w.name} ${num(w.items)}${w.unit} 대기`),
  ];
  return parts.join(" · ");
}

/** The second line: how soon it turns serious if nothing changes. Empty when it does not. */
export function impactWhen(impact: Impact): string {
  const s = impact.severe;
  if (!s) return "";
  if (s.kind === "power") return "전기가 끊긴 곳은 이미 꺼졌어요";
  if (s.minutes === 0) return `이미 심각해요(${s.celsius}°C)`;
  return `냉방이 그대로면 ${num(s.minutes)}분 뒤 심각(${s.celsius}°C)`;
}
