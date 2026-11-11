/**
 * A rack that holds exactly the servers it was asked for (REQ-111): the model the room picked is kept while the rest of
 * the servers still fit in the units and the power that are left, and the 1U model (the least a server takes) otherwise.
 */
import type { Catalog } from "@terrarium/core/catalog";

const SMALL = "srv-1u-compute";
/** Units of a rack the servers may take (the top of the rack is the ToR). */
const SERVER_UNITS = 40;

export function fitServer(
  catalog: Catalog,
  picked: string,
  /** Absent: the room's own pick stands (a rack filled by units). */
  state:
    | {
        /** Servers still to stand after this one. */
        readonly left: number;
        readonly unit: number;
        readonly peak: number;
        readonly budget: number;
      }
    | undefined,
): string {
  if (!state) return picked;
  const small = catalog.getOf(SMALL, "server");
  const model = catalog.getOf(picked, "server");
  const fitsUnits = state.unit + model.uHeight - 1 + state.left * small.uHeight <= SERVER_UNITS;
  const fitsPower = state.peak + model.maxPowerW + state.left * small.maxPowerW <= state.budget;
  return fitsUnits && fitsPower ? picked : SMALL;
}
