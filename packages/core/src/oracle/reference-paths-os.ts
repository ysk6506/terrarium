/** Reference paths of the faults inside a host's operating system (REQ-110, ADR-0133): look with the shell, mend with the shell, or move the service. */
import { change, path, type ReferencePath, read, sh } from "./reference-path";

const look = (cmd: string) => read("run_command", { host: "{target}", cmd });
const alarms = read("list_alarms");

export const OS_PATHS = {
  disk_full: path(
    [alarms, look("df -h")],
    [sh("{target}", "rm -f /var/log/*/*.log")],
    [look("df -h")],
  ),
  fs_readonly: path(
    [alarms, look("mount")],
    [sh("{target}", "mount -o remount,rw /")],
    [look("mount")],
  ),
  ntp_drift: path(
    [alarms, look("timedatectl")],
    [sh("{target}", "systemctl restart chronyd")],
    [look("timedatectl")],
  ),
  // a restart only pauses a leak and does nothing for a loop: the service goes to its standby
  memory_leak: path(
    [alarms, look("ps aux")],
    [change("failover_service", { service: "{service}" })],
  ),
  process_crashloop: path(
    [alarms, look("journalctl -n 20")],
    [change("failover_service", { service: "{service}" })],
  ),
} as const satisfies Partial<Record<string, ReferencePath>>;
