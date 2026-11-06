/** core.ranking: competition medals and tiers (REQ-101, ADR-0122). Pure; shown nowhere until 대회 모드. */
export {
  awardMedals,
  countMedals,
  LARGE_FROM,
  MEDAL_LABELS,
  MEDALS,
  type Medal,
  type MedalCounts,
  medalCutoffs,
  medalFor,
  medalPercents,
  NO_MEDALS,
  type Placed,
  type Placing,
} from "./medals";
export { higherTier, TIER_LABELS, TIER_RULES, TIERS, type TierId, tierOf } from "./tiers";
