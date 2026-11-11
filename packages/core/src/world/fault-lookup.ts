/** Fault lookups the world keeps until a fault starts or ends (physics asks for them per device per step). */

import type { Fault } from "./faults";
import type { BlueprintIndex } from "./graph";

export const NO_FAULTS: readonly Fault[] = Object.freeze([]);

export function groupByTarget(faults: readonly Fault[]): Map<string, Fault[]> {
  const out = new Map<string, Fault[]>();
  for (const fault of faults) {
    const list = out.get(fault.target);
    if (list) list.push(fault);
    else out.set(fault.target, [fault]);
  }
  return out;
}

/** The faults on each entity, in the order of `index.all()` (an empty list where there are none). */
export function faultsByPosition(
  index: BlueprintIndex,
  faults: readonly Fault[],
): ReadonlyArray<readonly Fault[]> {
  const out: Array<readonly Fault[]> = new Array(index.all().length).fill(NO_FAULTS);
  for (const fault of faults) {
    const at = index.positionOf(fault.target);
    if (at === undefined) continue; // a fault on a cable
    out[at] = [...(out[at] as readonly Fault[]), fault];
  }
  return out;
}
