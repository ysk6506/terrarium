/**
 * The outlets of a PDU (REQ-063, ADR-0060). A PDU has as many outlets as its model offers, or as many as
 * devices are cabled to it when that is more; outlet n is the n-th power cable into it, in cable order. An
 * operator can switch an outlet off, which cuts the device on that cable (an empty outlet just remembers).
 * A power shelf of an ORv3 rack has none: its devices sit on one busbar.
 */
import type { WorldReader } from "./world";

export function outletCount(world: WorldReader, pduId: string): number {
  const model = world.catalog.getOf(world.index.entity(pduId).modelId ?? "", "pdu");
  if (model.shelf) return 0;
  return Math.max(world.index.incoming(pduId, "power").length, model.outlets);
}

/** Whether an operator switched outlet `n` of the PDU off. */
export function outletOff(world: WorldReader, pduId: string, n: number): boolean {
  return world.stateAs(pduId, "pdu").outletsOff?.includes(n) ?? false;
}

/** The device cabled to outlet `n` (undefined for an empty outlet). */
export function outletConsumer(world: WorldReader, pduId: string, n: number) {
  const link = world.index.incoming(pduId, "power")[n - 1];
  return link ? world.index.find(link.from) : undefined;
}
