/** The helpers the chip tables are written with (REQ-094, REQ-107): split from ladder.ts for size. */
import type { ChipMech, LadderSpot, LayerId, Need } from "./ladder";

export const c = (
  layer: LayerId,
  id: string,
  rest: Omit<ChipMech, "id" | "layer" | "modeled" | "build" | "stops" | "slows" | "costM"> &
    Partial<Pick<ChipMech, "modeled" | "build" | "stops" | "slows" | "costM">>,
): ChipMech => ({
  ...rest,
  id,
  layer,
  modeled: rest.modeled ?? true,
  build: rest.build ?? {},
  stops: rest.stops ?? [],
  slows: rest.slows ?? [],
  costM: rest.costM ?? 0,
});

export const dotted = (
  layer: LayerId,
  id: string,
  buildsAs: string,
  costM = 0,
  requires?: readonly Need[],
): ChipMech => c(layer, id, { modeled: false, buildsAs, costM, ...(requires ? { requires } : {}) });

export const at = (layer: LayerId, atLeast: string): LadderSpot => ({ layer, atLeast });
