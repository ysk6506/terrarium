/** The fields a condition can test on the database and storage-HA entities (REQ-095). */
import { bool, type FieldSpec, HEALTH, num, version } from "./field-spec";

export const DB_CONDITION_FIELDS: Readonly<
  Record<
    "db_cluster" | "db_instance" | "storage_pool" | "storage_controller",
    Readonly<Record<string, FieldSpec>>
  >
> = {
  db_cluster: {
    health: HEALTH,
    primary: version("프라이머리 인스턴스"),
    splitBrain: bool("스플릿 브레인"),
    failovers: num("승격 수", "번"),
    lastLostS: num("마지막 승격에서 잃은 쓰기", "초"),
  },
  db_instance: {
    health: HEALTH,
    role: { label: "역할", type: "enum", values: ["primary", "secondary", "standby"] },
    status: { label: "상태", type: "enum", values: ["ok", "degraded", "down"] },
    lagS: num("복제 지연", "초"),
    dataLoss: bool("데이터를 잃었음"),
    readOnly: bool("쓰기 불가"),
  },
  storage_pool: {
    health: HEALTH,
    status: { label: "상태", type: "enum", values: ["ok", "degraded", "down"] },
    copies: num("복제본", "개"),
    rebuildPct: num("재복제 진행", "%"),
    dataLoss: bool("데이터를 잃었음"),
  },
  storage_controller: {
    health: HEALTH,
    active: bool("활성 경로"),
    status: { label: "상태", type: "enum", values: ["ok", "down"] },
    path: { label: "경로", type: "enum", values: ["ok", "cut"] },
  },
};
