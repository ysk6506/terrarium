/**
 * Competition medals (REQ-101, ADR-0122), Kaggle-style: a medal is the rank's place among everyone who took part.
 * Pure functions on numbers; nothing here reads a clock or a store. Percentages are whole numbers and the cut is
 * integer arithmetic, so 100 people at 15% is exactly rank 15, never 14.999999.
 */

export type Medal = "gold" | "silver" | "bronze";

export const MEDALS: readonly Medal[] = ["gold", "silver", "bronze"];

export const MEDAL_LABELS: Readonly<Record<Medal, string>> = {
  gold: "금메달",
  silver: "은메달",
  bronze: "동메달",
};

/** Up to 99 people the cuts are wider; from 100 on they are tighter. */
export const LARGE_FROM = 100;

/** The top percent each medal reaches, by how many took part. */
export function medalPercents(participants: number): Readonly<Record<Medal, number>> {
  return participants >= LARGE_FROM
    ? { gold: 5, silver: 15, bronze: 40 }
    : { gold: 10, silver: 25, bronze: 50 };
}

/** The last rank (1-based, ties share their first rank) that still gets each medal. A competition always has a gold. */
export function medalCutoffs(participants: number): Readonly<Record<Medal, number>> {
  if (!Number.isInteger(participants) || participants < 1) return { gold: 0, silver: 0, bronze: 0 };
  const pct = medalPercents(participants);
  const cut = (m: Medal) => Math.floor((participants * pct[m]) / 100);
  const gold = Math.max(1, cut("gold"));
  const silver = Math.max(gold, cut("silver"));
  const bronze = Math.max(silver, cut("bronze"));
  return { gold, silver, bronze };
}

/** The medal for a rank among `participants`, or nothing. A rank outside 1..participants gets nothing. */
export function medalFor(rank: number, participants: number): Medal | undefined {
  if (!Number.isInteger(rank) || rank < 1 || rank > participants) return undefined;
  const cut = medalCutoffs(participants);
  return MEDALS.find((m) => rank <= cut[m]);
}

export interface Placing {
  readonly key: string;
  readonly score: number;
}

export interface Placed extends Placing {
  /** 1-based; the same score shares the better rank (1, 2, 2, 4). */
  readonly rank: number;
  readonly medal?: Medal;
}

/** Everyone ranked by score, higher first, and the medal each rank gets. Ties keep the order they came in. */
export function awardMedals(entries: readonly Placing[]): Placed[] {
  const sorted = [...entries].sort((a, b) => b.score - a.score);
  let rank = 0;
  return sorted.map((entry, i) => {
    if (i === 0 || entry.score !== (sorted[i - 1] as Placing).score) rank = i + 1;
    const medal = medalFor(rank, sorted.length);
    return { ...entry, rank, ...(medal ? { medal } : {}) };
  });
}

export type MedalCounts = Readonly<Record<Medal, number>>;

export const NO_MEDALS: MedalCounts = { gold: 0, silver: 0, bronze: 0 };

export function countMedals(medals: Iterable<Medal | undefined>): MedalCounts {
  const counts = { gold: 0, silver: 0, bronze: 0 };
  for (const m of medals) if (m) counts[m] += 1;
  return counts;
}
