/**
 * 칭호 (REQ-101, ADR-0122) on screen: up to two next to a name, the rest in a small popover, each saying what earned it and
 * when. The names come from the server already worded with their number and unit; this only picks and dates them.
 */
import type { TitleView } from "@terrarium/core/contract";

/** How many sit next to a name. */
export const SHOWN_TITLES = 2;

export const NO_TITLES = "아직 얻은 칭호가 없어요 — 세계를 만들거나 실험을 돌리면 생겨요";

const KST_HOURS = 9;

/** The day in Korea, "2026-11-02". */
export function earnedDay(iso: string): string {
  return new Date(Date.parse(iso) + KST_HOURS * 3_600_000).toISOString().slice(0, 10);
}

/** What shows on hover or tap: "실험 100번 · 2026-11-02에 얻었어요". */
export const titleHint = (t: Pick<TitleView, "label" | "earnedAt">): string =>
  `${t.label} · ${earnedDay(t.earnedAt)}에 얻었어요`;

export interface TitleRow {
  readonly shown: readonly TitleView[];
  /** Titles beyond the ones shown; they are in the popover. */
  readonly more: number;
}

export function titleRow(titles: readonly TitleView[]): TitleRow {
  return { shown: titles.slice(0, SHOWN_TITLES), more: Math.max(0, titles.length - SHOWN_TITLES) };
}
