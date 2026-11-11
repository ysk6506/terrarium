/** Reference paths of the faults only another team can mend (REQ-110, ADR-0133): keep the service alive, hand the cause over, wait for the team. */
import { change, path, type ReferencePath, read, untilTeamDone } from "./reference-path";

const alarms = read("list_alarms");
const keepAlive = change("migrate_vm", { vm: "{vmOn}", host: "{@service_status/standby/0}" });

export const SERVER_PATHS = {
  // bad memory is the server team's: move the VM off the machine, hand it over, wait
  memory_failure: path(
    [alarms, read("service_status", { service: "{service}" })],
    [
      keepAlive,
      change("failover_service", { service: "{service}" }),
      change("escalate", { domain: "server", note: "메모리 불량" }),
      untilTeamDone,
    ],
  ),
  link_down: path(
    [alarms, read("service_status", { service: "{service}" })],
    [
      keepAlive,
      change("escalate", { domain: "network", note: "케이블이 끊겼어요" }),
      untilTeamDone,
    ],
  ),
} as const satisfies Partial<Record<string, ReferencePath>>;
