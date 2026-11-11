/** Reference paths of the site, DR, consensus-database and managed-database faults (REQ-110, ADR-0133). */
import { change, path, type ReferencePath, read, sh, waitEta } from "./reference-path";

const alarms = read("list_alarms");
const sites = read("site_status");
const DR = "{@site_status/sites/role!=primary/id}";
// two active sites both lead; the first stays
const PRIMARY = "{@site_status/sites/0/id}";
const move = (site: string) => change("dr_failover", { site });

/** A site that is gone: a hot or active pair moves by itself, a warm one is moved by hand, a cold one is handed to the facility team too. */
const POWER_LOSS = path([alarms, sites], [], [], {
  choose: {
    read: sites,
    at: "{@site_status/plans/0/mode}",
    cases: {
      hot: path([alarms], [], [], { handsOff: true, settleS: 300 }),
      active: path([alarms], [], [], { handsOff: true, settleS: 300 }),
      warm: path([alarms], [move(DR), waitEta("all")], []),
      cold: path(
        [alarms],
        [
          change("escalate", { domain: "facility", note: "본 사이트의 전기가 끊겼어요" }),
          move(DR),
          waitEta("all"),
        ],
        [],
      ),
    },
  },
});

export const SITE_PATHS = {
  site_power_loss: POWER_LOSS,
  // the automation hangs at its first step: pressed again, it goes on
  dr_failover_stuck: path(
    [alarms, sites],
    [move(DR), read("site_status"), move(DR), waitEta("all")],
    [],
  ),
  // both think they lead: keep the primary
  split_brain: path([alarms, sites], [move(PRIMARY), waitEta("all")], []),
  wan_link_down: path(
    [alarms, read("wan_status")],
    [change("escalate", { domain: "network", note: "사이트 사이 회선이 끊겼어요" })],
  ),
  replication_broken: path(
    [alarms, read("replication_status")],
    [sh("{host}", "systemctl restart replicad")],
  ),
  geo_replica_broken: path(
    [alarms, read("volume_replication_status")],
    [change("escalate", { domain: "storage", note: "다른 사이트의 볼륨 복사본이 깨졌어요" })],
  ),
  db_quorum_lost: path(
    [alarms, read("db_cluster_status")],
    [{ ...change("db_node_restart", { node: "{target}" }), forEach: "alarm:db_node_down" }],
  ),
  db_failover_flapping: path(
    [alarms, read("db_managed_status")],
    [
      change("db_managed_failover", {
        db: "{target}",
        az: "{@db_managed_status/databases/id={target}/zones/primary=false/name}",
      }),
    ],
  ),
  db_storage_full: path(
    [alarms, read("db_managed_status")],
    [change("db_managed_scale_storage", { db: "{target}" })],
  ),
} as const satisfies Partial<Record<string, ReferencePath>>;
