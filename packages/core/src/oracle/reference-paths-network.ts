/** Reference paths of the mistakes made on switches and PDUs (REQ-110, ADR-0133): put the setting back with the device's own commands. */
import { change, path, type ReferencePath, read } from "./reference-path";

const config = (device: string) =>
  read("network_cli", { device, commands: ["enable", "show running-config"] });
const cli = (commands: readonly string[]) =>
  change("network_cli", { device: "{target}", commands, configure: true });

export const NETWORK_PATHS = {
  port_vlan_mismatch: path(
    [read("list_alarms"), config("{target}")],
    [cli(["interface {port}", "switchport access vlan {vlan}"])],
  ),
  port_shutdown: path(
    [read("list_alarms"), config("{target}")],
    [cli(["interface {port}", "no shutdown"])],
  ),
  svi_shutdown: path(
    [read("list_alarms"), config("{target}")],
    [{ ...cli(["interface Vlan{p.vlan}", "no shutdown"]), forEach: "targets" }],
  ),
  route_missing: path(
    [read("list_alarms"), config("{target}")],
    [{ ...cli(["ip route {routeCmd}"]), forEach: "targets" }],
  ),
  bgp_neighbor_shutdown: path(
    [read("list_alarms"), config("{target}")],
    [cli(["router bgp {asn}", "no neighbor {shutNeighbor} shutdown"])],
  ),
  outlet_off: path(
    [read("list_alarms"), read("get_entity", { id: "{target}" })],
    [
      change("redfish_request", {
        server: "{target}",
        method: "POST",
        path: "/redfish/v1/PowerEquipment/RackPDUs/1/Outlets/{p.outlet}/Actions/Outlet.PowerControl",
        body: { PowerState: "On" },
      }),
    ],
  ),
} as const satisfies Partial<Record<string, ReferencePath>>;
