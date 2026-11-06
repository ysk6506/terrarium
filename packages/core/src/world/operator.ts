/**
 * What an operator's setting does to the world's state: a shut port end on a network link, an outlet
 * switched off on a PDU (REQ-062, REQ-063). Physics and the facades read these through the world.
 */
import type { EntityState, PduState, WorldState } from "./state";

/** Set how loaded a server, a VM or a light rack is (0..1); what that means differs by kind. */
export function setLoad(state: EntityState, value: number): void {
  if (state.kind === "server") state.cpuUtil = value;
  else if (state.kind === "vm") state.cpuDemand = value;
  else if (state.kind === "rack") state.util = value;
}

/** Mark or clear one end of a network link as shut by an operator; the marker is absent when no end is shut. */
export function setLinkAdmin(
  state: WorldState,
  linkId: string,
  end: "from" | "to",
  down: boolean,
): void {
  const link = state.links[linkId];
  if (!link) return;
  const shut = { ...link.adminDown };
  if (down) shut[end] = true;
  else delete shut[end];
  if (shut.from || shut.to) link.adminDown = shut;
  else delete link.adminDown;
}

/** Switch an outlet of a PDU off or on; the list stays ascending and is absent when every outlet is on. */
export function setOutlet(pdu: PduState, outlet: number, on: boolean): void {
  const off = new Set(pdu.outletsOff);
  if (on) off.delete(outlet);
  else off.add(outlet);
  if (off.size > 0) pdu.outletsOff = [...off].sort((a, b) => a - b);
  else delete pdu.outletsOff;
}
