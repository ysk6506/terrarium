/**
 * A catalog card as a service of the world (REQ-104, ADR-0127): the draft a person gets when they pick a card, and
 * the draft of a card somebody saved ("내 카드") with the name and numbers they kept. The shape is the card's; the
 * name and the damage numbers are the only things a saved card can differ in.
 */
import { type CatalogCard, DEFAULT_WORKLOAD, type WorkloadProfile } from "@terrarium/core/world";
import type { HarmTier, ServiceDraft } from "./shaped-plan";

/** The key a service gets in a world: the card's id, with a number from the second one on. */
export function catalogKey(cardId: string, taken: readonly string[]): string {
  if (!taken.includes(cardId)) return cardId;
  let n = 2;
  while (taken.includes(`${cardId}-${n}`)) n += 1;
  return `${cardId}-${n}`;
}

/** The card a key was made from (`web-api-2` came from `web-api`). */
export const cardOfKey = (key: string): string => key.replace(/-\d+$/, "");

/** What a saved card changes from its built-in card. */
export interface CardOverrides {
  readonly name?: string;
  readonly harm?: readonly HarmTier[];
}

export function cardWorkload(card: CatalogCard): WorkloadProfile {
  return DEFAULT_WORKLOAD[card.workload];
}

/** The service a card makes. `taken` are the keys already in the world; the new key never repeats one. */
export function draftFromCard(
  card: CatalogCard,
  taken: readonly string[],
  overrides: CardOverrides = {},
): ServiceDraft {
  const key = catalogKey(card.id, taken);
  // it calls the cards it names by default, as far as the world has them
  const calls = taken.filter((k) => card.calls.includes(cardOfKey(k)));
  const harm =
    overrides.harm && overrides.harm.length === card.tiers.length
      ? overrides.harm
      : card.tiers.map((t) => ({ name: t.name, perHourKrw: t.perHourKrw }));
  return {
    key,
    name: overrides.name?.trim() || card.name,
    gives: card.gives,
    stopsText: card.stopsText,
    kind: card.kind,
    nodes: card.nodes,
    hosts: card.hosts,
    switches: card.switches,
    parts: card.parts.map((p) => ({ ...p })),
    stops: card.stops.map((s) => ({ ...s })),
    harm,
    workload: cardWorkload(card),
    ...(calls.length > 0 ? { calls } : {}),
  };
}
