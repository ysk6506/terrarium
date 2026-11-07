/** The fields a condition can test on the site and DR entities (REQ-106). */
import { bool, type FieldSpec, HEALTH, num, version } from "./field-spec";

const LEVEL: FieldSpec = { label: "상태", type: "enum", values: ["ok", "degraded", "down"] };

export const SITE_CONDITION_FIELDS: Readonly<
  Record<
    | "dr_site"
    | "site_link"
    | "replication_stream"
    | "dr_plan"
    | "volume"
    | "db_node"
    | "db_managed",
    Readonly<Record<string, FieldSpec>>
  >
> = {
  dr_site: { health: HEALTH, status: LEVEL, up: num("켜진 서버", "대") },
  site_link: { health: HEALTH, status: LEVEL, latencyMs: num("지연", "ms") },
  replication_stream: {
    health: HEALTH,
    status: { label: "상태", type: "enum", values: ["ok", "lagging", "broken"] },
    lagS: num("복제 지연", "초"),
  },
  dr_plan: {
    health: HEALTH,
    serving: version("서비스가 도는 사이트"),
    phase: {
      label: "전환 단계",
      type: "enum",
      values: ["idle", "failing_over", "failing_back", "stuck"],
    },
    split: bool("스플릿 브레인"),
    lostS: num("잃은 쓰기", "초"),
  },
  volume: { health: HEALTH, status: LEVEL, lagS: num("복제 지연", "초") },
  db_node: {
    health: HEALTH,
    status: { label: "상태", type: "enum", values: ["ok", "down", "lagging"] },
    role: { label: "역할", type: "enum", values: ["leader", "follower"] },
    term: num("임기", "번"),
  },
  db_managed: {
    health: HEALTH,
    status: LEVEL,
    activeAz: num("주인 영역", "번째"),
    storageUsedPct: num("저장소 사용", "%"),
  },
};
