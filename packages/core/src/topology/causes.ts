/**
 * Where the trouble starts: what the scenario broke (faults) and what the world noticed (alarms). The board
 * paints the first red and the second orange; the impact range spreads from both.
 */
import type { BlueprintIndex, Fault } from "@terrarium/core/world";
import type { TopologySource } from "./types";

export interface Causes {
  /** Equipment a fault was put on (the two ends of a cut link). */
  readonly faulted: ReadonlySet<string>;
  /** Equipment with an alarm. */
  readonly alarmed: ReadonlySet<string>;
}

/** The equipment a fault lands on: its target, or the two ends when the target is a cable. */
function faultEquipment(index: BlueprintIndex, fault: Fault): string[] {
  if (index.has(fault.target)) return [fault.target];
  const ends = index.allLinks().find((l) => l.id === fault.target);
  return ends ? [ends.from, ends.to] : [];
}

export function causesOf(source: TopologySource): Causes {
  const { index } = source;
  const faulted = new Set<string>();
  for (const fault of source.faults())
    for (const id of faultEquipment(index, fault)) faulted.add(id);
  const alarmed = new Set<string>();
  for (const alarm of source.alarms()) if (index.has(alarm.entityId)) alarmed.add(alarm.entityId);
  return { faulted, alarmed };
}
