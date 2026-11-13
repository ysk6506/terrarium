/**
 * The audit screen as plain data (ADR-0198, permissions.md section 6): what the filters are and how they become a request,
 * and how one entry reads as a sentence a person can check ("김하늘이 시나리오 'X'를 고치려다 막혔어요"). The screen draws it.
 */
import type { AuditEntryView, AuditQueryParams } from "@terrarium/core/contract";
import type { AuditOutcome } from "@terrarium/core/experiments";

/** How far back a listing looks: a few plain periods, because nobody types a time to answer "what happened this week". */
export const PERIODS = [
  { value: "day", label: "오늘", ms: 24 * 3_600_000 },
  { value: "week", label: "7일", ms: 7 * 24 * 3_600_000 },
  { value: "month", label: "30일", ms: 30 * 24 * 3_600_000 },
  { value: "all", label: "전부" },
] as const;
export type Period = (typeof PERIODS)[number]["value"];

export const OUTCOME_FILTERS: readonly { value: AuditOutcome | ""; label: string }[] = [
  { value: "", label: "전부" },
  { value: "allowed", label: "했어요" },
  { value: "denied", label: "막혔어요" },
  { value: "failed", label: "안 됐어요" },
];

export const OUTCOME_WORDS: Readonly<Record<AuditOutcome, string>> = {
  allowed: "했어요",
  denied: "막혔어요",
  failed: "안 됐어요",
};

/** What the kinds of thing are called. Kinds this screen does not know are shown as they are written. */
export const KIND_WORDS: Readonly<Record<string, string>> = {
  world: "세계",
  scenario: "시나리오",
  experiment: "실험",
  run: "실행",
  connection: "연결",
  model: "모델",
  preset: "자주 쓰는 설정",
  service_card: "서비스 카드",
  audit: "감사 기록",
  session: "로그인",
  share: "공유 링크",
};

export const kindWord = (kind: string): string => KIND_WORDS[kind] ?? kind;

export interface AuditFilters {
  readonly period: Period;
  readonly outcome: AuditOutcome | "";
  /** A login id, or nothing for everyone. */
  readonly subject: string;
  readonly action: string;
  readonly kind: string;
}

export const NO_FILTERS: AuditFilters = {
  period: "week",
  outcome: "",
  subject: "",
  action: "",
  kind: "",
};

/** The request for a listing or a file. `now` is passed in so the same filters mean the same on a test's clock. */
export function queryOf(filters: AuditFilters, now: number): AuditQueryParams {
  const period = PERIODS.find((p) => p.value === filters.period);
  return {
    ...(period && "ms" in period ? { from: new Date(now - period.ms).toISOString() } : {}),
    ...(filters.outcome ? { outcome: filters.outcome } : {}),
    ...(filters.subject ? { subject: filters.subject } : {}),
    ...(filters.action
      ? { action: filters.action as NonNullable<AuditQueryParams["action"]> }
      : {}),
    ...(filters.kind ? { resourceKind: filters.kind } : {}),
  };
}

/** Whether any filter narrows beyond the starting week: the screen says so, and offers to clear them. */
export const narrowed = (f: AuditFilters): boolean =>
  f.outcome !== "" || f.subject !== "" || f.action !== "" || f.kind !== "" || f.period !== "week";

/** The name of the file a download is saved as, by the day. */
export const fileName = (now: number): string =>
  `terrarium-audit-${new Date(now).toISOString().slice(0, 10)}.jsonl`;

/** "시나리오 '팬 고장'": what the entry was about, with the name it had then. */
export function targetText(entry: AuditEntryView): string {
  const kind = kindWord(entry.resource.kind);
  return entry.resource.name ? `${kind} '${entry.resource.name}'` : kind;
}

const FIELD_WORDS: Readonly<Record<string, string>> = {
  scope: "누가 볼 수 있나요",
  group: "그룹",
  role: "역할",
  owner: "만든 사람",
  sharing: "공유",
};

const SCOPE_WORDS: Readonly<Record<string, string>> = {
  private: "나만",
  group: "우리 파트",
  everyone: "모두",
};

const valueText = (field: string, v: string | null): string => {
  if (v === null) return "없음";
  return field === "scope" ? (SCOPE_WORDS[v] ?? v) : v;
};

/** What a change moved, one phrase each: "누가 볼 수 있나요: 모두 → 나만". */
export function changeLines(entry: AuditEntryView): string[] {
  return (entry.changes ?? []).map(
    (c) =>
      `${FIELD_WORDS[c.field] ?? c.field}: ${valueText(c.field, c.before)} → ${valueText(c.field, c.after)}`,
  );
}

/** The reason an administrator gave for changing what is another person's, when there is one. */
export const reasonGiven = (entry: AuditEntryView): string | undefined => {
  const r = entry.detail?.reason;
  return typeof r === "string" ? r : undefined;
};

/** One line a person can read aloud: who, what, and how it ended. */
export function entryLine(entry: AuditEntryView): string {
  return `${entry.subject.name} · ${entry.label} · ${OUTCOME_WORDS[entry.outcome]}`;
}

/** Whether the entry went wrong for someone: a refusal or a failure draws the eye, a plain success does not. */
export const draws = (entry: AuditEntryView): boolean => entry.outcome !== "allowed";

/** The first line over a page of entries: how many are shown and whether more wait. */
export function pageLine(shown: number, more: boolean): string {
  if (shown === 0) return "조건에 맞는 기록이 없어요";
  return more ? `${shown}줄을 보고 있어요. 더 있어요` : `${shown}줄이에요`;
}

/** When it was written, in the viewer's clock: "11월 12일 14:03". */
export function atText(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
