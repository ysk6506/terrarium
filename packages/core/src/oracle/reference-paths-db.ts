/** Reference paths of the database and storage faults (REQ-110, ADR-0133). */
import { change, path, type ReferencePath, read, sh } from "./reference-path";

const alarms = read("list_alarms");
const status = read("db_status", { cluster: "{alarm:db_no_primary}" });
const PROMOTE = change("db_promote", { instance: "{sibling}" });

export const DB_PATHS = {
  // no primary and no automatic failover: the secondary is promoted by hand. A cluster that fails over by itself has no
  // such alarm: look, name the cause, change nothing and wait for it to promote
  db_primary_down: path([alarms, status], [PROMOTE], [], {
    choose: {
      read: alarms,
      at: "{@list_alarms/code=db_no_primary/code}",
      cases: {
        db_no_primary: path([status], [PROMOTE]),
        "": path([read("db_status", { cluster: "{target}" })], [], [], {
          handsOff: true,
          settleS: 120,
        }),
      },
    },
  }),
  db_replication_broken: path(
    [alarms, read("db_status", { cluster: "{alarm:db_replication_lag}" })],
    [sh("{host}", "systemctl restart postgresql")],
  ),
  // both think they are primary: keep the first instance
  db_split_brain: path(
    [alarms, read("db_status", { cluster: "{alarm:db_split_brain}" })],
    [change("db_promote", { instance: "{nth:db_instance:0}" })],
  ),
  storage_path_cut: path(
    [alarms, read("storage_status", { id: "{alarm:storage_pool_down}" })],
    [change("storage_path_switch", { controller: "{sibling}" })],
  ),
  // the pool rebuilds the copy by itself: look, change nothing, answer
  storage_node_lost: path(
    [alarms, read("storage_status", { id: "{alarm:storage_pool_degraded}" })],
    [],
    [],
    { handsOff: true, settleS: 1500 },
  ),
} as const satisfies Partial<Record<string, ReferencePath>>;

export const DB_VARIANTS = {
  // the newest backup is damaged: the older one restores
  "db-restore-corrupt-backup": path(
    [alarms, status],
    [change("db_restore", { instance: "{target}", backup: "{@db_status/backups/-1/id}" })],
    [],
    { settleS: 1200 },
  ),
} as const satisfies Partial<Record<string, ReferencePath>>;
