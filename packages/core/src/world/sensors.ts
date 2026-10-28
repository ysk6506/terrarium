/**
 * What sensors report, as opposed to the true state. Monitoring (physics alarms) and the BMC (Redfish)
 * both read sensors, so a drifting sensor raises real-looking alarms about a temperature that is fine.
 */
import type { WorldReader } from "./world";

/** A server's inlet temperature as its sensor reports it: the true value plus any sensor_drift. */
export function reportedInletC(
  world: Pick<WorldReader, "stateAs" | "faultsOn">,
  serverId: string,
): number {
  const drift = world.faultsOn(serverId).find((f) => f.type === "sensor_drift")?.params.deltaC ?? 0;
  return world.stateAs(serverId, "server").inletC + drift;
}
