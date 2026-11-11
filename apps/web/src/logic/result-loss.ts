/**
 * Where the points went (ADR-0171): the scoring criteria as bars, the one that lost the most first, and one sentence
 * made from the numbers alone. Nothing is said that the numbers do not say: when nothing was lost, it says so.
 */
import type { CriterionRate } from "@terrarium/core/analysis";
import { withJosa } from "@terrarium/core/kernel";
import { pointsText } from "./result-words";

export interface LossRow {
  readonly id: string;
  readonly label: string;
  /** Points possible; 0 for a penalty, which only takes points away. */
  readonly max: number;
  /** Average points earned (negative for a penalty). */
  readonly earned: number;
  /** Average points lost: the max less what was earned. */
  readonly lost: number;
  /** The length of the track against the longest one, 0–1: proportional to the max. */
  readonly track: number;
  /** The filled part of the track, 0–1: what was earned of the max. */
  readonly fill: number;
  readonly penalty: boolean;
  /** Not one run earned anything from it (or, for a penalty, every run lost points to it). */
  readonly missedAll: boolean;
  /** "42.7 / 60", or "−2.5점" for a penalty. */
  readonly text: string;
}

/** Less than this is rounding, not a loss. */
const NOTHING = 0.05;

function rowOf(c: CriterionRate, longest: number): LossRow {
  const penalty = c.max === 0;
  const earned = c.meanPoints;
  const lost = Math.max(0, c.max - earned);
  return {
    id: c.id,
    label: c.label,
    max: c.max,
    earned,
    lost: lost < NOTHING ? 0 : lost,
    track: penalty || longest === 0 ? 0 : c.max / longest,
    fill: penalty || c.max === 0 ? 0 : Math.min(1, Math.max(0, earned / c.max)),
    penalty,
    missedAll: c.rate === 0 && (penalty ? earned < 0 : earned <= 0),
    text: penalty
      ? earned < 0
        ? `−${pointsText(-earned)}점`
        : "감점 없음"
      : `${pointsText(earned)} / ${c.max}`,
  };
}

/** The criteria, the one that lost the most points first; equal losses keep the sheet's order. */
export function lossRows(criteria: readonly CriterionRate[]): LossRow[] {
  const longest = Math.max(0, ...criteria.map((c) => c.max));
  return criteria
    .map((c, at) => ({ row: rowOf(c, longest), at }))
    .sort((a, b) => b.row.lost - a.row.lost || a.at - b.at)
    .map((x) => x.row);
}

/** The sentence above the bars; empty when there is no criterion to speak of. */
export function lossSentence(rows: readonly LossRow[], done: number): string {
  const total = rows.reduce((s, r) => s + r.lost, 0);
  const top = rows[0];
  if (!top) return "";
  if (total === 0) return "잃은 점수가 없어요. 모든 항목에서 만점을 받았어요.";
  const share = top.lost / total;
  const part = share >= 0.995 ? "잃은 점수가 모두" : `잃은 점수의 ${Math.round(share * 100)}%가`;
  const every =
    top.missedAll && done > 0
      ? ` ${done}번 모두 ${top.penalty ? "감점됐어요" : "점수를 받지 못했어요"}.`
      : "";
  return `가장 많이 잃은 곳은 ${withJosa(top.label, "이에요")}. ${part} 여기서 나왔어요.${every}`;
}
