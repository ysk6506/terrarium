/** How a blueprint's props and links set the first state of a server or a service. */

import type { Entity } from "./blueprint";
import type { BlueprintIndex } from "./graph";
import type { StateOf } from "./state";

/** A blueprint can say how loaded a server is and which firmware versions it was built with. */
export function applyServerProps(state: StateOf<"server">, props: Entity["props"]): void {
  if (typeof props.cpuUtil === "number") state.cpuUtil = props.cpuUtil;
  if (typeof props.bmcVersion === "string") state.bmcVersion = props.bmcVersion;
  if (typeof props.biosVersion === "string") state.biosVersion = props.biosVersion;
  // the servers of a cold DR site are installed and cabled but switched off (REQ-106)
  if (props.adminOff === true) state.adminOn = false;
}

/** A service starts where the blueprint's `service_on` links say: the active places run it, the standby ones wait. */
export function placeService(state: StateOf<"service">, id: string, index: BlueprintIndex): void {
  for (const link of index.outgoing(id, "service_on")) {
    (link.props.role === "standby" ? state.standby : state.runsOn).push(link.to);
  }
}
