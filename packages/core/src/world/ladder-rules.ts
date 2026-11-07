/**
 * What the choices on the ladders need of each other (REQ-102, ADR-0123): a cloud-native network wants containers under
 * it, a cluster that moves VMs wants shared storage. The rules are data on the chips (`requires`, `pointlessWith` in
 * ladder.ts); this file reads them. "At least" is a place on the ladder: the named choice or any to its right.
 */
import { LADDER, LAYER_IDS, type LadderSpot, type LayerId, type Layers, type Need } from "./ladder";

export type { LadderSpot, Need, Pointless } from "./ladder";

/** A choice's place on its ladder, from 0 (left); -1 when the layer has no such choice. */
export const placeOf = (layer: LayerId, id: string): number =>
  LADDER[layer].findIndex((chip) => chip.id === id);

/** Whether the layers stand at or to the right of the spot. */
export const reaches = (layers: Layers, spot: LadderSpot): boolean =>
  placeOf(spot.layer, layers[spot.layer]) >= placeOf(spot.layer, spot.atLeast);

/** A need is met when its spot is reached, or the other spot it may be met by. */
export const needMet = (layers: Layers, need: Need): boolean =>
  reaches(layers, need) || (need.orElse !== undefined && reaches(layers, need.orElse));

/** The needs of this choice (of layer `layer`, id `id`) that the other layers do not meet. */
export function unmetNeeds(layers: Layers, layer: LayerId, id: string): readonly Need[] {
  const chip = LADDER[layer].find((c) => c.id === id);
  return (chip?.requires ?? []).filter((need) => !needMet(layers, need));
}

/** A choice whose need is not met, and the need. */
export interface Unmet {
  readonly layer: LayerId;
  readonly chip: string;
  readonly need: Need;
}

/** Every chosen choice whose need the layers do not meet. Empty: the combination is whole. */
export function unmetOf(layers: Layers): readonly Unmet[] {
  return LAYER_IDS.flatMap((layer) =>
    unmetNeeds(layers, layer, layers[layer]).map((need) => ({ layer, chip: layers[layer], need })),
  );
}

const costOf = (spot: LadderSpot): number =>
  LADDER[spot.layer].find((c) => c.id === spot.atLeast)?.costM ?? 0;

/** The way to meet a need that costs least: the spot itself, or the other one when that is cheaper. */
export function cheapestWay(need: Need): LadderSpot {
  const { orElse, ...first } = need;
  return orElse && costOf(orElse) < costOf(first) ? orElse : first;
}

/**
 * The layers with `chip` chosen on `layer`, and whatever it needs raised to the nearest choice that meets the need
 * (never lowered, so a raise cannot break a need that was met). A need raised may need more; that is raised too.
 */
export function withChoice(layers: Layers, layer: LayerId, chip: string): Layers {
  let next: Layers = { ...layers, [layer]: chip };
  for (let round = 0; round < LAYER_IDS.length * 2; round++) {
    const open = unmetOf(next)[0];
    if (!open) break;
    const way = cheapestWay(open.need);
    next = { ...next, [way.layer]: way.atLeast };
  }
  return next;
}

/** A pair that is allowed but makes little sense: the layer holding the rule's owner, both choices, and the note. */
export interface PointlessPair {
  readonly layer: LayerId;
  readonly chip: string;
  readonly other: LayerId;
  readonly otherChip: string;
  readonly note: string;
}

/** The pointless pairs among the chosen choices. */
export function pointlessOf(layers: Layers): readonly PointlessPair[] {
  return LAYER_IDS.flatMap((layer) => {
    const chip = LADDER[layer].find((c) => c.id === layers[layer]);
    return (chip?.pointlessWith ?? [])
      .filter((p) => layers[p.layer] === p.chip)
      .map((p) => ({
        layer,
        chip: layers[layer],
        other: p.layer,
        otherChip: p.chip,
        note: p.note,
      }));
  });
}
