/**
 * The rules table of "알아서" (REQ-109, ADR-0132): what the numbers a service carries ask of each layer. Every rule
 * says "at least this choice": the layer takes the right-most choice among its usual pick and every rule that holds, so a
 * higher number never lowers a layer. The rules are the table in `docs/design-docs/world-entry.md`; `LOAD_RULE_ROWS` is
 * what the doc prints, and a test keeps the two together. The reason a rule gives quotes the number that triggered it.
 */
import {
  dataText,
  downtimeText,
  type LayerId,
  placeOf,
  type ServiceLoad,
} from "@terrarium/core/world";

type Load = Required<ServiceLoad>;

const people = (n: number): string => `${Math.round(n).toLocaleString("ko-KR")}명`;
const times = (n: number): string => `${Math.round(n).toLocaleString("ko-KR")}건`;
const hours = (n: number): string => `${Math.round(n).toLocaleString("ko-KR")}시간`;

export interface LoadRule {
  readonly layer: LayerId;
  /** The choice the layer is raised to when the rule holds. */
  readonly id: string;
  /** The condition, as the doc prints it. */
  readonly text: string;
  /** Whether it holds; `current` is the layer's choice so far (a rule may read it). */
  readonly when: (load: Load, current: string) => boolean;
  /** The reason, quoting the number. */
  readonly why: (load: Load) => string;
}

/** "이라서" after a final consonant, "라서" after a vowel. */
const isa = (word: string): string => {
  const c = word.charCodeAt(word.length - 1);
  return c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 !== 0 ? "이라서" : "라서";
};

const rule = (r: LoadRule): LoadRule => r;

/** In the order they are applied; the table in the doc keeps this order. */
export const LOAD_RULES: readonly LoadRule[] = [
  rule({
    layer: "network",
    id: "net-leaf-spine",
    text: "동시 사용자 ≥ 5,000명",
    when: (l) => l.users >= 5_000,
    why: (l) => `동시 사용자 ${people(l.users)}${isa(people(l.users))} 랙 사이 길을 넓게`,
  }),
  rule({
    layer: "compute",
    id: "cmp-virt-ha",
    text: "허용 중단 ≤ 60초",
    when: (l) => l.maxDowntimeS <= 60,
    why: (l) =>
      `중단 허용 ${downtimeText(l.maxDowntimeS)}${isa(downtimeText(l.maxDowntimeS))} 호스트가 죽어도 VM이 옮겨 가게`,
  }),
  rule({
    layer: "compute",
    id: "cmp-drs",
    text: "허용 중단 ≤ 10초",
    when: (l) => l.maxDowntimeS <= 10,
    why: (l) =>
      `중단 허용 ${downtimeText(l.maxDowntimeS)}${isa(downtimeText(l.maxDowntimeS))} VM이 알아서 자리를 옮기게`,
  }),
  rule({
    layer: "accel",
    id: "gpu-training-cluster",
    text: "GPU 학습 > 0시간",
    when: (l) => l.gpuHours > 0,
    why: (l) => `GPU 학습 ${hours(l.gpuHours)}${isa(hours(l.gpuHours))} 학습 클러스터`,
  }),
  rule({
    layer: "storage",
    id: "sto-dual-controller",
    text: "허용 중단 ≤ 60초",
    when: (l) => l.maxDowntimeS <= 60,
    why: (l) =>
      `중단 허용 ${downtimeText(l.maxDowntimeS)}${isa(downtimeText(l.maxDowntimeS))} 컨트롤러 하나가 죽어도 이어가게`,
  }),
  rule({
    layer: "storage",
    id: "sto-distributed",
    text: "데이터 ≥ 10,000 GB",
    when: (l) => l.dataGB >= 10_000,
    why: (l) => `데이터 ${dataText(l.dataGB)}${isa(dataText(l.dataGB))} 여러 노드에 나눠 저장`,
  }),
  rule({
    layer: "database",
    id: "db-auto-failover",
    text: "허용 중단 ≤ 60초",
    when: (l) => l.maxDowntimeS <= 60,
    why: (l) =>
      `중단 허용 ${downtimeText(l.maxDowntimeS)}${isa(downtimeText(l.maxDowntimeS))} 자동 페일오버`,
  }),
  rule({
    layer: "database",
    id: "db-distributed-sql",
    text: "허용 중단 ≤ 10초",
    when: (l) => l.maxDowntimeS <= 10,
    why: (l) =>
      `중단 허용 ${downtimeText(l.maxDowntimeS)}${isa(downtimeText(l.maxDowntimeS))} 노드가 죽어도 멈추지 않는 분산 SQL`,
  }),
  rule({
    layer: "app",
    id: "app-stateless",
    text: "초당 요청 ≥ 1,000건",
    when: (l) => l.rps >= 1_000,
    why: (l) => `초당 요청 ${times(l.rps)}${isa(times(l.rps))} 어느 서버로 가도 같게(상태 없는 앱)`,
  }),
  rule({
    layer: "app",
    id: "app-microservices",
    text: "초당 요청 ≥ 10,000건",
    when: (l) => l.rps >= 10_000,
    why: (l) => `초당 요청 ${times(l.rps)}${isa(times(l.rps))} 기능별로 나눠 따로 늘리게`,
  }),
  rule({
    layer: "power",
    id: "pwr-n1-ups",
    text: "허용 중단 ≤ 30초",
    when: (l) => l.maxDowntimeS <= 30,
    why: (l) =>
      `중단 허용 ${downtimeText(l.maxDowntimeS)}${isa(downtimeText(l.maxDowntimeS))} 정전에도 UPS로 이어가게`,
  }),
  rule({
    layer: "site",
    id: "site-two-rooms",
    text: "허용 중단 ≤ 30초",
    when: (l) => l.maxDowntimeS <= 30,
    why: (l) =>
      `중단 허용 ${downtimeText(l.maxDowntimeS)}${isa(downtimeText(l.maxDowntimeS))} 방 하나가 막혀도 돌게`,
  }),
  rule({
    layer: "site",
    id: "site-two-buildings",
    text: "허용 중단 ≤ 5초",
    when: (l) => l.maxDowntimeS <= 5,
    why: (l) =>
      `중단 허용 ${downtimeText(l.maxDowntimeS)}${isa(downtimeText(l.maxDowntimeS))} 건물 하나가 막혀도 돌게`,
  }),
  rule({
    layer: "site",
    id: "site-dr-hot",
    text: "허용 중단 ≤ 30초이고 사이트가 건물 둘 이상",
    when: (l, current) =>
      l.maxDowntimeS <= 30 && placeOf("site", current) >= placeOf("site", "site-two-buildings"),
    why: (l) =>
      `중단 허용 ${downtimeText(l.maxDowntimeS)}${isa(downtimeText(l.maxDowntimeS))} 사이트가 사라져도 바로 이어가게`,
  }),
];

/** The choice of a layer after the rules: the right-most of `base` and every rule that holds, and the reason it gives (the base's when no rule lifted it). */
export function applyRules(
  layer: LayerId,
  base: { readonly id: string; readonly why: string },
  load: Load,
): { readonly id: string; readonly why: string; readonly byRule: boolean } {
  let id = base.id;
  let why = base.why;
  let byRule = false;
  for (const r of LOAD_RULES) {
    if (r.layer !== layer || !r.when(load, id)) continue;
    const at = placeOf(layer, r.id);
    if (at > placeOf(layer, id)) {
      id = r.id;
      why = r.why(load);
      byRule = true;
    } else if (layer === "accel" && at === placeOf(layer, id) && load.gpuHours > 0) {
      // the GPU card names itself (REQ-107); the number it carries is said beside it
      why = `${base.why} (GPU 학습 ${hours(load.gpuHours)})`;
    }
  }
  return { id, why, byRule };
}

/** One row of the doc's table: layer, the condition and the choice it raises to. */
export const LOAD_RULE_ROWS: ReadonlyArray<{ layer: LayerId; text: string; id: string }> =
  LOAD_RULES.map(({ layer, text, id }) => ({ layer, text, id }));
