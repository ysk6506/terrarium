/**
 * The tools of the database and storage-HA layers (REQ-095, ADR-0107 item 6): look at a database cluster or a storage
 * pool, promote an instance, force a failover, restore from a backup, switch the path to the other controller. They
 * live in a file of their own, like the hand-over tools, and are added to the catalog at its end. Every one is a tool
 * a real operations team has (`common`); the database ones belong to the service/OS team, the storage ones to the
 * storage team (domains.ts).
 */
import type { JsonSchema, ToolSpec } from "./catalog";
import type { ToolDoc } from "./docs";

type DbSpec = Omit<ToolSpec, "realism" | "description" | "area">;

const obj = (properties: JsonSchema["properties"], required: string[] = []): JsonSchema => ({
  type: "object",
  properties,
  required,
});
const str = (description: string) => ({ type: "string", description });

export const DB_SPECS: readonly DbSpec[] = [
  {
    name: "db_status",
    title: "데이터베이스 상태",
    category: "observe",
    mutating: false,
    inputSchema: obj(
      { cluster: str("Database cluster id (an instance id also works: its cluster is shown)") },
      ["cluster"],
    ),
  },
  {
    name: "db_promote",
    title: "인스턴스 승격",
    category: "act",
    mutating: true,
    inputSchema: obj({ instance: str("Database instance id to make the primary") }, ["instance"]),
  },
  {
    name: "db_failover",
    title: "클러스터 페일오버",
    category: "act",
    mutating: true,
    inputSchema: obj({ cluster: str("Database cluster id") }, ["cluster"]),
  },
  {
    name: "db_restore",
    title: "백업에서 복원",
    category: "act",
    mutating: true,
    inputSchema: obj(
      {
        instance: str("Database instance id to restore"),
        backup: str("latest (default) or backup-1 … backup-N, 1 the newest"),
      },
      ["instance"],
    ),
  },
  {
    name: "storage_status",
    title: "스토리지 상태",
    category: "observe",
    mutating: false,
    inputSchema: obj({ id: str("Storage pool id, or a storage controller id") }, ["id"]),
  },
  {
    name: "storage_path_switch",
    title: "스토리지 경로 전환",
    category: "act",
    mutating: true,
    inputSchema: obj({ controller: str("Storage controller id whose path the hosts should use") }, [
      "controller",
    ]),
  },
];

const d = (doc: ToolDoc): ToolDoc => doc;

export const DB_DOCS: Readonly<Record<string, ToolDoc>> = {
  db_status: d({
    area: "observe",
    realism: "common",
    summary:
      "One database cluster in detail: its shape, who is primary, each instance (role, state, replication lag, whether it can write), the failover setting and the backups.",
    use: "a service that needs a database is down or slow, or an alarm names an instance, and you want to know which instance is the primary, how far the copies are behind and whether the cluster will fail over by itself.",
    notUse:
      "you want the host's own numbers (use run_command on the host) or the storage under it (use storage_status).",
    example: '{"cluster":"db-iap"}',
    cost: "low",
    costWhy: "one cluster",
    details:
      "For a cluster that fails over by itself, `autoFailover.promotesInSeconds` says how long until it promotes (it waits for the detection time first). `lagSeconds` is how many seconds of writes a copy has not received yet: that is what a promotion of it would lose.",
  }),
  db_promote: d({
    area: "act",
    realism: "common",
    summary:
      "Make a database instance the primary of its cluster; the old primary becomes a secondary. The writes a copy had not received yet are lost.",
    use: "the primary is down or unusable and a secondary or standby is up; or two instances claim to be primary (split brain) and you choose the one that stays.",
    notUse:
      "the cluster fails over by itself and the detection time has not passed (look first with db_status), or the instance is down, or it is already the primary.",
    example: '{"instance":"db-iap-2"}',
    cost: "medium",
    costWhy: "one change that loses the writes a copy was behind; check lagSeconds first",
    details:
      "The answer says how many seconds of writes were lost (the lag of the promoted copy). In a split brain the instance you name stays and the other is fenced off: what it wrote since the split is thrown away.",
  }),
  db_failover: d({
    area: "act",
    realism: "common",
    summary:
      "Make the cluster fail over now: it promotes the secondary that is least behind and the old primary becomes a secondary.",
    use: "the primary is gone and you do not want to pick the instance yourself, or the cluster has not noticed yet.",
    notUse:
      "the cluster is a single instance, or two instances claim to be primary (choose one with db_promote), or no other instance is up.",
    example: '{"cluster":"db-iap"}',
    cost: "medium",
    costWhy: "one change that loses the writes the chosen copy was behind",
  }),
  db_restore: d({
    area: "act",
    realism: "common",
    summary:
      "Restore a database instance from a backup. The instance is down while it restores (about 20 minutes); a primary loses everything written since the backup.",
    use: "a single instance is gone for good, or a copy must be built again, and no other instance can take over.",
    notUse:
      "another instance can be promoted (that loses far less), or the instance is fine: restoring overwrites its data.",
    example: '{"instance":"db-iap-1","backup":"latest"}',
    cost: "high",
    costWhy:
      "the instance is down for the whole restore, and a bad backup fails after a few minutes",
    details:
      "Backups are backup-1 (the newest, also `latest`) and older ones. A backup can be damaged without anyone knowing: the restore checks it and fails if it is. Then try an older one.",
  }),
  storage_status: d({
    area: "observe",
    realism: "common",
    summary:
      "One storage pool in detail: its state, the controllers and the path in use, or the nodes and the copies of the data and how far the next copy is made.",
    use: "a database or service is slow or stopped and the storage under it may be the cause, or an alarm names a controller or a node.",
    notUse: "you want a disk or an array's own sensors (use get_entity or redfish_request).",
    example: '{"id":"pool-iap"}',
    cost: "low",
    costWhy: "one pool, read once",
    details:
      "For a pool with two controllers it shows which path the hosts use and whether `multipath` switches by itself. For a distributed pool it shows `copies` of `wanted` and `rebuildPercent`.",
  }),
  storage_path_switch: d({
    area: "act",
    realism: "common",
    summary:
      "Make the hosts use the path through another storage controller. The controller must be healthy and its path whole.",
    use: "the controller of the path in use failed or its path was cut, and the pool has no multipath that switches by itself.",
    notUse:
      "the pool has multipath (the hosts switch by themselves within seconds), or the other controller is also down.",
    example: '{"controller":"ctl-iap-b"}',
    cost: "low",
    costWhy: "one change",
  }),
};
