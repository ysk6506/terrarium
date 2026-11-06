/**
 * Tiers from medal counts (REQ-101, ADR-0122). A tier belongs to the person who submitted the agent, not to the agent.
 * A better medal always satisfies what a lower one would: a gold is also "at least a silver" and "at least a bronze".
 * Nothing shows a tier yet; it appears with 대회 모드.
 */
import type { MedalCounts } from "./medals";

export type TierId = "sprout" | "participant" | "expert" | "master" | "grandmaster";

export const TIERS: readonly TierId[] = [
  "sprout",
  "participant",
  "expert",
  "master",
  "grandmaster",
];

export const TIER_LABELS: Readonly<Record<TierId, string>> = {
  sprout: "새싹",
  participant: "참가자",
  expert: "전문가",
  master: "마스터",
  grandmaster: "그랜드마스터",
};

/** What each tier asks for, in words (for the docs and, later, the screen). */
export const TIER_RULES: Readonly<Record<TierId, string>> = {
  sprout: "메달이 아직 없어요",
  participant: "메달 1개 이상",
  expert: "동메달 이상 2개 또는 은메달 이상 1개",
  master: "금메달 1개 이상, 거기에 은메달 이상 2개 더",
  grandmaster: "금메달 5개 이상",
};

export function tierOf(counts: MedalCounts): TierId {
  const { gold, silver } = counts;
  const total = gold + silver + counts.bronze;
  if (gold >= 5) return "grandmaster";
  if (gold >= 1 && gold + silver >= 3) return "master";
  if (total >= 2 || gold + silver >= 1) return "expert";
  if (total >= 1) return "participant";
  return "sprout";
}

/** Whether `a` is a higher tier than `b`. */
export const higherTier = (a: TierId, b: TierId): boolean => TIERS.indexOf(a) > TIERS.indexOf(b);
