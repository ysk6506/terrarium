/**
 * UX Honeycomb scoring (REQ-041, ADR-0031). The browser run (tests/e2e/ux) only counts what it saw;
 * everything that turns counts into 0-100 lives here, in plain functions that are unit-tested.
 * A measure with no evidence scores 0, so leaving something unmeasured never raises a score.
 */

export const FACETS = [
  "useful",
  "usable",
  "desirable",
  "findable",
  "accessible",
  "credible",
  "valuable",
] as const;
export type Facet = (typeof FACETS)[number];

export const FACET_LABELS: Readonly<Record<Facet, string>> = {
  useful: "유용함",
  usable: "사용성",
  desirable: "매력",
  findable: "찾기 쉬움",
  accessible: "접근성",
  credible: "신뢰",
  valuable: "가치",
};

/** The journeys people do, and the most actions (clicks, typed fields, keys) each should take from the home page. */
export const JOURNEY_BUDGETS = {
  build: 8,
  design: 8,
  author: 8,
  run: 6,
  cancel: 8,
  share: 5,
  fork: 6,
  compare: 4,
  site: 6,
  "build-small": 8,
  "own-card-only": 18,
  topology: 5,
} as const;
export type JourneyId = keyof typeof JOURNEY_BUDGETS;
export const JOURNEY_IDS = Object.keys(JOURNEY_BUDGETS) as JourneyId[];

export const JOURNEY_LABELS: Readonly<Record<JourneyId, string>> = {
  build: "사업장 그대로 만들고 랙 놓기",
  design: "시나리오 설계하고 저장",
  author: "빈 시나리오에서 시작해 시험지 점검까지",
  run: "실험 만들고 결과 보기",
  cancel: "도는 실험 멈추기",
  share: "결과 링크 공유하고 열기",
  fork: "조건 바꿔 다시 돌리기",
  compare: "벤치마크에서 비교하고 가져오기",
  site: "새 사업장 만들고 땅 사기",
  "build-small": "작게 시작해서 서버룸 채우고 시운전",
  "own-card-only": "IAP를 빼고 내 카드만으로 세계 만들기",
  topology: "화성 실제 그대로 세계에서 토폴로지 열기",
};

/** Budgets for the load of the home page. */
export const LOAD_BUDGET = { kb: 700, ms: 2500 } as const;

/** How many of something was tried and how many went right. */
export interface Tally {
  readonly tried: number;
  readonly ok: number;
}

export interface JourneyResult {
  readonly ok: boolean;
  readonly actions: number;
  readonly note?: string;
}

export interface Measurements {
  readonly journeys: Readonly<Record<JourneyId, JourneyResult>>;
  /** Pages visited during the journeys without a console error, an uncaught error or a failed request. */
  readonly clean: Tally;
  /** Wrong input that was answered at once with what is wrong. */
  readonly invalid: Tally;
  /** Colour values written in the stylesheet, and those written outside the theme tokens. */
  readonly colors: { readonly literals: number; readonly offToken: number };
  /** Long jobs that showed progress while they ran. */
  readonly progress: Tally;
  readonly load: { readonly kb: number; readonly ms: number; readonly sceneDrawn: boolean };
  /** Pages reachable from home in two clicks. */
  readonly reach: Tally;
  /** Pages with a distinct title, a heading, and their place marked in the navigation. */
  readonly orientation: Tally;
  readonly axe: {
    readonly pages: number;
    readonly critical: number;
    readonly serious: number;
    readonly moderate: number;
  };
  readonly keyboard: Tally;
  /** Tab stops that show where the focus is. */
  readonly focus: Tally;
  /** Elements still animating when the person asked for less motion. */
  readonly motion: { readonly animated: number };
  /** Error screens that say what happened and what to do next. */
  readonly failures: Tally;
  /** Empty screens that say why they are empty and what to do. */
  readonly empties: Tally;
  /** Numbers that say, in text anyone can read, what they are. */
  readonly provenance: Tally;
  /** What a decision needs, found on the result screen without hunting. */
  readonly value: Tally;
  /** Lines of text in the friendly tone (해요체) out of all lines on the screens (REQ-058). */
  readonly voice: Tally;
  /** Screens that ask for one main thing at a time. */
  readonly oneThing: Tally;
  /** Buttons named for what they do. */
  readonly buttons: Tally;
  /** Controls big enough to hit out of all controls (REQ-058). */
  readonly targets: Tally;
  /** Switched-off buttons that say why out of all switched-off buttons. */
  readonly disabledWhy: Tally;
  /** Lone numbers that say what they count. */
  readonly units: Tally;
  /** Buttons whose look answers the pointer. */
  readonly hover: Tally;
}

export interface Measure {
  readonly id: string;
  readonly label: string;
  /** 0 to 1. */
  readonly score: number;
  readonly evidence: string;
}

export interface FacetReport {
  readonly score: number;
  readonly measures: readonly Measure[];
}

export type Report = Readonly<Record<Facet, FacetReport>>;

const clamp = (n: number) => Math.min(1, Math.max(0, n));
const round1 = (n: number) => Math.round(n * 10) / 10;

export function ratio(t: Tally): number {
  return t.tried <= 0 ? 0 : clamp(t.ok / t.tried);
}

/** 1 within the budget, falling to 0 at twice the budget. */
export function withinBudget(actual: number, budget: number): number {
  if (actual <= budget) return 1;
  return clamp(1 - (actual - budget) / budget);
}

const tally = (id: string, label: string, t: Tally): Measure => ({
  id,
  label,
  score: ratio(t),
  evidence: t.tried === 0 ? "측정된 것이 없다" : `${t.ok} / ${t.tried}`,
});

function useful(m: Measurements): Measure[] {
  const done = JOURNEY_IDS.filter((id) => m.journeys[id].ok);
  const failed = JOURNEY_IDS.filter((id) => !m.journeys[id].ok);
  return [
    {
      id: "journeys",
      label: "여정을 끝까지 해낸 비율",
      score: done.length / JOURNEY_IDS.length,
      evidence:
        failed.length === 0
          ? `${done.length} / ${JOURNEY_IDS.length}`
          : `못한 것: ${failed.join(", ")}`,
    },
    tally("clean", "오류 없이 지나간 화면", m.clean),
  ];
}

function usable(m: Measurements): Measure[] {
  const scores = JOURNEY_IDS.map((id) => {
    const j = m.journeys[id];
    return j.ok ? withinBudget(j.actions, JOURNEY_BUDGETS[id]) : 0;
  });
  const over = JOURNEY_IDS.filter(
    (id) => m.journeys[id].ok && m.journeys[id].actions > JOURNEY_BUDGETS[id],
  ).map((id) => `${id} ${m.journeys[id].actions}/${JOURNEY_BUDGETS[id]}`);
  return [
    {
      id: "actions",
      label: "여정마다 손이 드는 횟수가 예산 안인가",
      score: scores.reduce((a, b) => a + b, 0) / scores.length,
      evidence: over.length === 0 ? "모두 예산 안" : `예산 넘음: ${over.join(", ")}`,
    },
    tally("invalid", "잘못 넣으면 바로 알려 주는 입력", m.invalid),
    tally("voice", "화면의 글이 한결같이 해요체인가", m.voice),
    tally("one-thing", "한 화면에 주된 행동이 하나인가", m.oneThing),
    tally("buttons", "버튼 이름이 할 일을 말하는가", m.buttons),
    tally("disabled-why", "꺼진 버튼이 이유를 말하는가", m.disabledWhy),
    tally("hover", "포인터에 반응하는 버튼", m.hover),
  ];
}

function desirable(m: Measurements): Measure[] {
  const { literals, offToken } = m.colors;
  return [
    {
      id: "tokens",
      label: "색을 디자인 토큰으로만 쓰는 비율",
      score: literals <= 0 ? 0 : clamp(1 - offToken / literals),
      evidence: `토큰 밖의 색 ${offToken}개 / 색 ${literals}개`,
    },
    tally("progress", "오래 걸리는 일의 진행 표시", m.progress),
    {
      id: "load-size",
      label: "첫 화면이 내려받는 양",
      score: withinBudget(m.load.kb, LOAD_BUDGET.kb),
      evidence: `${Math.round(m.load.kb)} kB (예산 ${LOAD_BUDGET.kb} kB)`,
    },
    {
      id: "load-time",
      label: "첫 화면이 뜨는 시간",
      score: withinBudget(m.load.ms, LOAD_BUDGET.ms),
      evidence: `${Math.round(m.load.ms)} ms (예산 ${LOAD_BUDGET.ms} ms)`,
    },
    {
      id: "scene",
      label: "3D 장면이 그려지는가",
      score: m.load.sceneDrawn ? 1 : 0,
      evidence: m.load.sceneDrawn ? "그려졌다" : "빈 화면이다",
    },
  ];
}

function findable(m: Measurements): Measure[] {
  return [
    tally("reach", "홈에서 두 번 눌러 닿는 화면", m.reach),
    tally("orientation", "제목과 현재 위치가 보이는 화면", m.orientation),
  ];
}

export function axeScore(a: Measurements["axe"]): number {
  if (a.pages <= 0) return 0;
  return clamp(1 - 0.2 * a.critical - 0.1 * a.serious - 0.02 * a.moderate);
}

function accessible(m: Measurements): Measure[] {
  const { critical, serious, moderate, pages } = m.axe;
  return [
    {
      id: "axe",
      label: "자동 접근성 검사(axe)",
      score: axeScore(m.axe),
      evidence: `${pages}개 화면에서 치명 ${critical}, 심각 ${serious}, 보통 ${moderate}`,
    },
    tally("keyboard", "키보드만으로 해낸 일", m.keyboard),
    tally("focus", "초점이 보이는 칸", m.focus),
    tally("targets", "손가락으로 누를 만큼 큰 컨트롤", m.targets),
    {
      id: "motion",
      label: "움직임 줄이기를 지키는가",
      score: clamp(1 - m.motion.animated / 10),
      evidence: `줄이기를 켜도 움직이는 것 ${m.motion.animated}개`,
    },
  ];
}

function credible(m: Measurements): Measure[] {
  return [
    tally("failures", "원인과 다음 할 일을 말하는 오류 화면", m.failures),
    tally("empties", "이유와 다음 할 일을 말하는 빈 화면", m.empties),
    tally("provenance", "무엇인지 글로 밝힌 수치", m.provenance),
    tally("units", "단위나 이름이 붙은 숫자", m.units),
  ];
}

function valuable(m: Measurements): Measure[] {
  return [tally("decision", "결과 화면이 결정을 돕는 정도", m.value)];
}

const FACET_MEASURES: Readonly<Record<Facet, (m: Measurements) => Measure[]>> = {
  useful,
  usable,
  desirable,
  findable,
  accessible,
  credible,
  valuable,
};

export function scoreAll(m: Measurements): Report {
  const out = {} as Record<Facet, FacetReport>;
  for (const facet of FACETS) {
    const measures = FACET_MEASURES[facet](m);
    const mean = measures.reduce((sum, x) => sum + x.score, 0) / measures.length;
    out[facet] = { score: round1(mean * 100), measures };
  }
  return out;
}

export function scoresOf(report: Report): Record<Facet, number> {
  return Object.fromEntries(FACETS.map((f) => [f, report[f].score])) as Record<Facet, number>;
}

// ------------------------------------------------------------------------------------ reading

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const count = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;

function tallyOf(raw: unknown, where: string): Tally {
  if (!isObject(raw) || !count(raw.tried) || !count(raw.ok) || raw.ok > raw.tried)
    throw new Error(`${where}: {tried, ok} 꼴의 수여야 한다 (ok는 tried를 넘을 수 없다)`);
  return { tried: raw.tried, ok: raw.ok };
}

function counts<K extends string>(
  raw: unknown,
  keys: readonly K[],
  where: string,
): Record<K, number> {
  if (!isObject(raw)) throw new Error(`${where}: 객체여야 한다`);
  const out = {} as Record<K, number>;
  for (const key of keys) {
    const value = raw[key];
    if (!count(value)) throw new Error(`${where}.${key}: 0 이상의 수여야 한다`);
    out[key] = value;
  }
  return out;
}

function journeysOf(raw: unknown): Record<JourneyId, JourneyResult> {
  if (!isObject(raw)) throw new Error("journeys: 객체여야 한다");
  const out = {} as Record<JourneyId, JourneyResult>;
  for (const id of JOURNEY_IDS) {
    const j = raw[id];
    if (!isObject(j) || typeof j.ok !== "boolean" || !count(j.actions))
      throw new Error(`journeys.${id}: {ok, actions}가 있어야 한다`);
    out[id] = {
      ok: j.ok,
      actions: j.actions,
      ...(typeof j.note === "string" ? { note: j.note } : {}),
    };
  }
  return out;
}

/** Check a measurement file read from disk; throws a message that says which part is wrong. */
export function parseMeasurements(raw: unknown): Measurements {
  if (!isObject(raw)) throw new Error("측정 결과가 객체가 아니다");
  const load = isObject(raw.load) ? raw.load : {};
  if (typeof load.sceneDrawn !== "boolean")
    throw new Error("load.sceneDrawn: true나 false여야 한다");
  const { kb, ms } = counts(load, ["kb", "ms"], "load");
  return {
    journeys: journeysOf(raw.journeys),
    clean: tallyOf(raw.clean, "clean"),
    invalid: tallyOf(raw.invalid, "invalid"),
    colors: counts(raw.colors, ["literals", "offToken"], "colors"),
    progress: tallyOf(raw.progress, "progress"),
    load: { kb, ms, sceneDrawn: load.sceneDrawn },
    reach: tallyOf(raw.reach, "reach"),
    orientation: tallyOf(raw.orientation, "orientation"),
    axe: counts(raw.axe, ["pages", "critical", "serious", "moderate"], "axe"),
    keyboard: tallyOf(raw.keyboard, "keyboard"),
    focus: tallyOf(raw.focus, "focus"),
    motion: counts(raw.motion, ["animated"], "motion"),
    failures: tallyOf(raw.failures, "failures"),
    empties: tallyOf(raw.empties, "empties"),
    provenance: tallyOf(raw.provenance, "provenance"),
    value: tallyOf(raw.value, "value"),
    voice: tallyOf(raw.voice, "voice"),
    oneThing: tallyOf(raw.oneThing, "oneThing"),
    buttons: tallyOf(raw.buttons, "buttons"),
    targets: tallyOf(raw.targets, "targets"),
    disabledWhy: tallyOf(raw.disabledWhy, "disabledWhy"),
    units: tallyOf(raw.units, "units"),
    hover: tallyOf(raw.hover, "hover"),
  };
}
