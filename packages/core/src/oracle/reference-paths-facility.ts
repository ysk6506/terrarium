/** Reference paths of the facility faults: cooling, power, plant (REQ-110, ADR-0133). */
import { change, path, type ReferencePath, read } from "./reference-path";

const ONLY_ANSWER = (look: string) => path([read("get_entity", { id: look })], []);

export const FACILITY_PATHS = {
  fan_failure: ONLY_ANSWER("{target}"),
  sensor_drift: ONLY_ANSWER("{target}"),
  chiller_failure: ONLY_ANSWER("{target}"),
  cooling_unit_failure: path(
    [read("list_alarms"), read("get_entity", { id: "{target}" })],
    [
      // a room whose only unit is the one that stopped has no other unit to turn down
      {
        ...change("set_cooling_setpoint", { unitId: "{required}", celsius: "{minSetpoint}" }),
        when: "{required}",
      },
    ],
  ),
  breaker_trip: path(
    [read("list_alarms"), read("get_entity", { id: "{target}" })],
    [change("reset_breaker", { id: "{target}" })],
  ),
  vm_cpu_spike: path(
    [read("list_alarms"), read("get_entity", { id: "{target}" })],
    [
      change("vcenter_request", {
        method: "POST",
        path: "/api/vcenter/vm/{required}/power",
        query: { action: "stop" },
      }),
    ],
  ),
  cdu_failure: path(
    [read("list_alarms"), read("get_entity", { id: "{target}" })],
    [change("power_server", { id: "{target}", action: "off" }, "required")],
  ),
  utility_outage: path(
    [read("list_alarms"), read("facility_status")],
    // "shed" is the one step the solver reads as a many-call change: every server the sheet does not keep
    [change("shed"), change("set_power_cap", { server: "{target}", watts: 100 }, "critical")],
  ),
} as const satisfies Partial<Record<string, ReferencePath>>;
