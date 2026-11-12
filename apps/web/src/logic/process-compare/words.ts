/** The words of the process comparison screens (REQ-112, ADR-0135). 해요체, no "장애", numbers with their unit. */
import type { ProcessNumbers } from "@terrarium/core/analysis";
import { formatDuration } from "@terrarium/core/kernel";

/** 시나리오 이름에서 " — " 뒤의 설명은 떼고 고장 이름만: "서버 메모리 불량 — 서버 팀에 넘겨요" → "서버 메모리 불량". */
export const shortName = (name: string): string => name.split(" — ")[0]?.trim() || name;

export const TABLE_WORDS = {
  title: (scenario: string) => `${shortName(scenario)}일 때, 지금은 누가 뭘 하나요?`,
  sub: '적은 대로 비교에 써요. 측정값이 아니라 "지금 하는 방식(적은 값)"으로 표시돼요.',
  head: { n: "순서", who: "누가", what: "무엇을", time: "걸리는 시간", kind: "종류" },
  whoHint: "예: 모니터링 담당",
  whatHint: "예: 알람 확인",
  add: "+ 단계 더하기",
  save: "저장",
  saved: "저장했어요",
  full: "단계는 30개까지 적을 수 있어요",
  empty: "단계를 하나 이상 적으면 저장할 수 있어요",
  left: (n: number) => `${n}개 칸을 마저 채우거나 지워 주세요`,
  readOnly: (owner: string) => `${owner} 님이 적은 표예요. 고치려면 그분에게 부탁해 주세요`,
  summaryLead: "지금 하는 방식:",
  next: "이 표로 실험 만들기",
} as const;

export const COMPARE_WORDS = {
  title: (scenario: string) => `${shortName(scenario)} — 업무로 보면`,
  sub: "같은 고장, 두 방식.",
  written: "지금 하는 방식",
  writtenLab: "적은 값",
  measured: "에이전트가 하면",
  measuredLab: (runs: number) => `테라리움에서 잰 값 · ${runs}번 평균`,
  steps: "단계",
  stepsLeft: "단계 남음",
  people: "사람",
  time: "시간",
  write: "지금 하는 방식 적기",
  writeHint: "적어 두면 이 숫자와 나란히 놓아 줘요",
  ledger: "단계 장부",
  ledgerOf: (n: number, runs: number) =>
    `${runs}번 중 ${n}번째 실행 (평균 시간에 가장 가까운 실행)`,
  tools: (n: number) => `툴 ${n}번`,
  noRuns: "끝난 실행이 있으면 여기에 단계 장부가 나와요",
} as const;

/** "3시간 50분", "45분", "30초": minutes are the smallest unit people count a process in, so seconds only show below one. */
export function timeText(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}초`;
  return formatDuration(Math.round(s / 60) * 60);
}

/** The same with a sign for a change: "−2시간 25분", "+10분", "0분". */
export function signedTime(seconds: number): string {
  if (Math.round(seconds / 60) === 0 && Math.abs(seconds) < 60) return "0분";
  return `${seconds < 0 ? "−" : "+"}${timeText(Math.abs(seconds))}`;
}

const numText = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export const signedCount = (n: number): string =>
  n === 0 ? "0" : `${n < 0 ? "−" : "+"}${numText(Math.abs(n))}`;

export const countText = numText;

/** "5단계 · 사람 4명 · 3시간 50분": the written side's line, which the table's footer and the comparison share. */
export function numbersLine(n: ProcessNumbers): string {
  return `${numText(n.steps)}단계 · 사람 ${numText(n.people)}명 · ${timeText(n.seconds)}`;
}

/** The "hh:mm" the ledger counts its ranges in. */
export function clock(seconds: number): string {
  const m = Math.floor(Math.max(0, seconds) / 60);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export const ONTOLOGY_WORDS = {
  title: "이 세계에 필요한 액션",
  sub: (scenarios: number) =>
    `왼쪽은 이 세계의 시나리오 ${scenarios}개를 풀려면 어떤 액션이 있어야 하는지(시나리오 정의에서 뽑음), 오른쪽은 고른 실험에서 그 액션을 실제로 누가 했는지예요.`,
  needs: "필요한 것",
  used: "실제로 쓴 것",
  cols: {
    action: "액션",
    target: "대상 객체",
    faults: "이 액션으로 푸는 고장",
    who: "누가",
    count: "몇 번",
  },
  counts: (o: number, l: number, a: number) => `객체 ${o}종 · 링크 ${l}종 · 액션 ${a}개`,
  more: (n: number) => `${n}개 더 보기`,
  less: "접기",
  pick: "실험 고르기",
  noExperiment: "실험을 고르면 실제로 쓴 것이 나와요",
  extra: "시나리오엔 없던 액션",
  moss: "이끼의 설명",
  export: "객체·링크·액션 표 내보내기",
  exportCsv: "CSV로 받기",
  exportJson: "JSON으로 받기",
  none: "이 세계에는 아직 시나리오가 없어요. 시나리오를 만들면 필요한 액션이 여기에 나와요",
} as const;

/** "6개 — 호스트 정지 · 외 5": the faults an action clears. */
export function faultsText(labels: readonly string[]): string {
  const [first] = labels;
  if (!first) return "—";
  return labels.length === 1 ? first : `${labels.length}개 — ${first} · 외 ${labels.length - 1}`;
}
