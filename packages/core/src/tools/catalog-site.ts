/**
 * The tools of the site and DR layer, the geo volumes and the two new databases (REQ-106, ADR-0129): look at the sites, the
 * copies and the WAN, move the services to the other site and back, run a dry run of the move; look at a volume's copy and
 * promote it; look at a consensus ring, restart a node, hand over the lead; look at a managed database, choose its zone,
 * grow its storage. They live in a file of their own and are added to the catalog at its end.
 */
import type { JsonSchema, ToolSpec } from "./catalog";
import type { ToolDoc } from "./docs";

type SiteSpec = Omit<ToolSpec, "realism" | "description" | "area">;

const obj = (properties: JsonSchema["properties"], required: string[] = []): JsonSchema => ({
  type: "object",
  properties,
  required,
});
const str = (description: string) => ({ type: "string", description });

const observe = (name: string, title: string, inputSchema: JsonSchema): SiteSpec => ({
  name,
  title,
  category: "observe",
  mutating: false,
  inputSchema,
});
const act = (name: string, title: string, inputSchema: JsonSchema): SiteSpec => ({
  name,
  title,
  category: "act",
  mutating: true,
  inputSchema,
});

export const SITE_SPECS: readonly SiteSpec[] = [
  observe(
    "site_status",
    "사이트·DR 상태",
    obj({ site: str("Site id; leave out to see every site") }),
  ),
  observe(
    "replication_status",
    "복제 스트림 상태",
    obj({ copies: str("Service, database or volume id; leave out to see every stream") }),
  ),
  observe(
    "wan_status",
    "사이트 간 회선 상태",
    obj({ link: str("WAN link id; leave out for the link between the two sites") }),
  ),
  act(
    "dr_failover",
    "서비스를 다른 사이트로 전환",
    obj({ site: str("Site id that should run the services") }, ["site"]),
  ),
  act(
    "dr_failback",
    "본 사이트로 되돌리기",
    obj({ plan: str("DR plan id; leave out for the only plan") }),
  ),
  act("dr_drill", "전환 모의 훈련", obj({ plan: str("DR plan id; leave out for the only plan") })),
  observe(
    "volume_replication_status",
    "볼륨 복제 상태",
    obj({ volume: str("Volume id; leave out to see every volume") }),
  ),
  act(
    "volume_promote",
    "볼륨 복사본 올리기",
    obj({ volume: str("Volume id"), site: str("Site id whose copy becomes the writable one") }, [
      "volume",
      "site",
    ]),
  ),
  observe(
    "db_cluster_status",
    "합의 DB 상태",
    obj({ service: str("Service id; leave out to see every ring") }),
  ),
  act("db_node_restart", "합의 DB 노드 다시 시작", obj({ node: str("db_node id") }, ["node"])),
  act(
    "db_transfer_leader",
    "합의 DB 리더 넘기기",
    obj({ node: str("db_node id that should lead") }, ["node"]),
  ),
  observe(
    "db_managed_status",
    "관리형 DB 상태",
    obj({ service: str("Service id; leave out to see every managed database") }),
  ),
  act(
    "db_managed_failover",
    "관리형 DB 영역 고르기",
    obj(
      { db: str("db_managed id"), az: str("Availability zone: its number (1 first) or its name") },
      ["db", "az"],
    ),
  ),
  act(
    "db_managed_scale_storage",
    "관리형 DB 저장소 늘리기",
    obj({ db: str("db_managed id") }, ["db"]),
  ),
];

const d = (doc: ToolDoc): ToolDoc => doc;

export const SITE_DOCS: Readonly<Record<string, ToolDoc>> = {
  site_status: d({
    area: "observe",
    realism: "rare",
    summary:
      "The sites of the world and the DR plan: each site's role, mode, distance and how many servers are up, where the services run now, the failover phase, the promised RTO and RPO, and the last dry run.",
    use: "a whole building is unreachable, services stopped together, or you must know which site runs the services and what recovery was promised.",
    notUse: "one server or one rack is the trouble (use list_alarms and the host tools).",
    example: '{"site":"site-a"}',
    cost: "low",
    costWhy: "one read of the plan",
    details:
      "A cold site is powered off and needs hours; a warm site needs an operator and takes minutes; a hot site moves by itself about 90 seconds after it sees the primary gone; an active-active pair drains a dead site in about 30 seconds.",
  }),
  replication_status: d({
    area: "observe",
    realism: "rare",
    summary:
      "Every copy stream between the sites: what it copies (a service, a database, a volume), synchronous or asynchronous, ok / lagging / broken, and how many seconds the other site trails.",
    use: "you must know how much a failover would lose, or a copy is suspected broken.",
    notUse: "you want the state of the link itself (use wan_status).",
    example: '{"copies":"svc-iap"}',
    cost: "low",
    costWhy: "one read of the streams",
    details:
      "The seconds a stream trails are the writes a failover now would lose. A synchronous stream falls back to asynchronous 30 seconds after the link stops answering.",
  }),
  wan_status: d({
    area: "observe",
    realism: "common",
    summary:
      "The WAN link between the two sites: ok, degraded or down, one-way latency, bandwidth and how many times the normal lag the copies trail.",
    use: "copies trail, a synchronous stream stalls, or the other site cannot be reached.",
    notUse: "the trouble is inside one site (use list_alarms and the network tools of that site).",
    example: '{"link":"wan-ab"}',
    cost: "low",
    costWhy: "one read of the link",
  }),
  dr_failover: d({
    area: "act",
    realism: "rare",
    summary:
      "Run the protected services, databases and volumes at the other site. A site kept switched off is started and rebuilt (hours), a half-sized one starts its copies (minutes), a full mirror only switches. Also finishes a failover that stopped half-way, and picks the site to keep when both sites led.",
    use: "the primary site is lost and the plan does not move by itself, a failover is stuck, or site_status shows a split brain.",
    notUse:
      "the primary site is fine (nothing to gain, and writes the copy lacks are lost), or a failover is already running.",
    example: '{"site":"site-b"}',
    cost: "high",
    costWhy: "a move of a whole site, and the writes the copy trails are lost",
    details:
      "The result says how long the move takes and how many seconds of writes it loses. Run dr_drill first when there is time.",
  }),
  dr_failback: d({
    area: "act",
    realism: "rare",
    summary:
      "Move the services back to the primary site once it is well. The copy is turned round and caught up first.",
    use: "the primary site is back and the services still run at the DR site.",
    notUse: "the primary site is not well yet, or the WAN link is down.",
    example: '{"plan":"dr-plan"}',
    cost: "medium",
    costWhy: "a planned move",
  }),
  dr_drill: d({
    area: "act",
    realism: "rare",
    summary:
      "A dry run of the failover: it moves nothing and tells the time the move would take now and the seconds of writes it would lose, against the promised RTO and RPO figures.",
    use: "before you decide to fail over, or to find out whether the DR plan still keeps its promise.",
    notUse: "a move is running.",
    example: '{"plan":"dr-plan"}',
    cost: "low",
    costWhy: "nothing moves; only the time of the drill is noted",
  }),
  volume_replication_status: d({
    area: "observe",
    realism: "common",
    summary:
      "Each geo-replicated volume: which site holds the writable copy, the other site's copy, whether it is broken, and how far it trails.",
    use: "a storage array or a site is down and you want to know whether a copy exists elsewhere, or reads at the other site are old.",
    notUse: "the volume has no copy at another site.",
    example: '{"volume":"vol-billing"}',
    cost: "low",
    costWhy: "one read of the volume",
  }),
  volume_promote: d({
    area: "act",
    realism: "rare",
    summary:
      "Make the other site's copy of a volume the writable one. What the copy trails is lost. The service must be moved to that site too (failover_service) or it reaches the volume across the WAN.",
    use: "the volume's own site cannot serve it and a copy exists, and you want the volume and the service moved one by one.",
    notUse:
      "dr_failover would do the whole move, the copy is broken, or the volume's own site is well.",
    example: '{"volume":"vol-billing","site":"site-b"}',
    cost: "high",
    costWhy: "the writes the copy trails are lost",
  }),
  db_cluster_status: d({
    area: "observe",
    realism: "common",
    summary:
      "Each consensus database ring: the nodes with role (leader or follower), term, status and how far they trail, the votes needed for a majority and how many are up, and whether an election is running.",
    use: "writes stop or stall, an alarm names a db node, or you want to know who leads.",
    notUse:
      "the database is a db_cluster (use db_status) or a managed database (use db_managed_status).",
    example: '{"service":"svc-ledger"}',
    cost: "low",
    costWhy: "one read of the ring",
    details:
      "A ring needs a majority of its nodes. With the majority up a new leader is elected 10 seconds after the old one is gone; without it nothing is elected and writes stop.",
  }),
  db_node_restart: d({
    area: "act",
    realism: "common",
    summary:
      "Restart one node of a consensus ring. A dead or lagging node comes back as a follower and catches up.",
    use: "db_cluster_status shows a node down or lagging.",
    notUse:
      "the node is well, or the whole ring is down because the hosts lost power (restart them first).",
    example: '{"node":"svc-ledger-n2"}',
    cost: "low",
    costWhy: "one node restarts and rejoins",
  }),
  db_transfer_leader: d({
    area: "act",
    realism: "common",
    summary: "Hand the lead of the ring to a healthy node. It does not fix a lagging or dead node.",
    use: "the leader runs on a slow host or next to a lagging node and you want the lead elsewhere.",
    notUse: "the target node is down or lagging, or the ring has no majority.",
    example: '{"node":"svc-ledger-n3"}',
    cost: "low",
    costWhy: "one hand-over",
  }),
  db_managed_status: d({
    area: "observe",
    realism: "common",
    summary:
      "Each managed multi-AZ database: its zones and which one holds the primary, status, a write stall in progress, storage use and when it grows by itself, how many times it switched, the maintenance window and the cost an hour.",
    use: "writes stall or fail, or the provider flagged a zone problem.",
    notUse: "the database is a db_cluster or a consensus ring.",
    example: '{"service":"svc-ledger"}',
    cost: "low",
    costWhy: "one read of the console",
    details:
      "The provider switches zones by itself about 30 seconds after it sees the primary's zone gone; writes fail for about a minute during the switch. The cloud is simulated inside the world; costs are per hour.",
  }),
  db_managed_failover: d({
    area: "act",
    realism: "common",
    summary:
      "Choose the zone that holds the primary and keep it there. Writes stall for about a minute. Stops a failover that flaps.",
    use: "a zone is going bad and you do not want to wait for the provider, or the database switches zones again and again.",
    notUse: "the zone is down itself, or it already holds the primary.",
    example: '{"db":"svc-ledger-managed","az":"2"}',
    cost: "medium",
    costWhy: "writes stall during the switch",
  }),
  db_managed_scale_storage: d({
    area: "act",
    realism: "common",
    summary:
      "Grow the managed database's storage now, without waiting for the automatic growth (about 10 minutes after it is full).",
    use: "writes fail because storage is full, or use is above 80%.",
    notUse: "storage has room.",
    example: '{"db":"svc-ledger-managed"}',
    cost: "low",
    costWhy: "a larger bill per hour",
  }),
};
