/**
 * 점수를 묻는 말의 찾기 규칙 (REQ-103, ADR-0125). BM25만으로는 "이 실행이 왜 18.2점이에요?"가 채점 문서가 아니라
 * 실행 방법 문서로 갔다. 그래서 작고 고정된 규칙 둘을 둔다 — 임베딩도 모델도 없다.
 *
 * 1. 질문에 채점 낱말(`SCORING_WORDS`)이 있으면, 채점을 설명하는 문서(`SCORING_FILES`)의 조각 점수에 `SCORING_BOOST`배.
 *    이미 낱말이 하나라도 맞은 조각만 오르고, 다른 문서를 밀어내지는 않는다(곱셈이라 순서만 바뀐다).
 * 2. 화면 상태에 실행 결과의 채점표(`채점표`)가 있으면, 그 표로 "이 실행의 채점표" 조각을 만들어 문서 조각 앞에 둔다.
 *    모델이 이 실행의 숫자를 문서의 일반론보다 먼저 읽는다. 출처로는 문서가 아니라 "화면 상태"로 보인다.
 */
import type { MossChunk } from "./moss-index";

/** 채점 낱말. 질문에 하나라도 있으면 채점 질문이다. 숫자 바로 뒤의 "점"("18.2점")도 쳐요. */
export const SCORING_WORDS: readonly RegExp[] = [
  /점수/,
  /점이에요|점인가요|점이야|점이죠/,
  /\d\s*점/,
  /채점/,
  /불?합격/,
  /감점|만점|득점/,
  /mttr/i,
  /복구\s*(시간|순서|점수)/,
  /진단\s*(점수|·보고)/,
];

/** 채점을 설명하는 문서: 측정의 신뢰, 복구 우선 채점(ADR-0091), 그 구현이 고친 시험(ADR-0104). */
export const SCORING_FILES: ReadonlySet<string> = new Set([
  "docs/design-docs/measurement.md",
  "docs/design-docs/adr/0091-service-os-layer-recovery-first.md",
  "docs/design-docs/adr/0104-recovery-scoring-amend-tests.md",
]);

/** 채점 질문일 때 채점 문서 조각의 점수에 곱하는 값. 크면 다른 문서를 가리고, 작으면 소용이 없다 (은행 전체로 재서 정했다). */
export const SCORING_BOOST = 2;

export const isScoringQuestion = (question: string): boolean =>
  SCORING_WORDS.some((w) => w.test(question));

/** 이 질문이면 이 조각의 점수에 곱할 값. */
export const boostFor = (question: string, chunk: MossChunk): number =>
  SCORING_FILES.has(chunk.file) && isScoringQuestion(question) ? SCORING_BOOST : 1;

export const SCORING_CHUNK_ID = "state#채점표";

const text = (v: unknown): string =>
  typeof v === "string" || typeof v === "number" ? String(v) : "";

/** 화면 상태(결과 화면의 `runState`)가 채점표를 가졌으면 "이 실행의 채점표" 조각. 아니면 없음. */
export function scoringChunk(state: unknown): MossChunk | undefined {
  const s = state as Record<string, unknown> | null | undefined;
  const items = s?.채점표;
  if (!s || !Array.isArray(items) || items.length === 0) return undefined;
  const rows = items.map((raw) => {
    const i = raw as Record<string, unknown>;
    const why = text(i.이유);
    return `- ${text(i.항목)}: ${text(i.판정)}, ${text(i.점수)}점${why ? ` — ${why}` : ""}`;
  });
  const head = [text(s.점수) && `점수 ${text(s.점수)}`, text(s.합격)].filter(Boolean).join(", ");
  const summary = text(s.채점_요약);
  return {
    id: SCORING_CHUNK_ID,
    file: "(화면 상태)",
    path: ["이 실행의 채점표"],
    title: "이 실행의 채점표",
    text: [head, ...rows, summary && `요약: ${summary}`].filter(Boolean).join("\n"),
    synthetic: true,
  };
}
