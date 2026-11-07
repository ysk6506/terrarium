/** The fields a condition can test on the application-layer entities (REQ-100). */
import { DB_CONDITION_FIELDS } from "./blocks-db";
import { K8S_CONDITION_FIELDS } from "./blocks-k8s";
import { SDN_CONDITION_FIELDS } from "./blocks-sdn";
import { bool, type FieldSpec, HEALTH, num } from "./field-spec";

const STATUS3: FieldSpec = { label: "상태", type: "enum", values: ["ok", "degraded", "down"] };
const STATUS2: FieldSpec = { label: "상태", type: "enum", values: ["ok", "down"] };

export const APP_CONDITION_FIELDS: Readonly<
  Record<
    | "app_instance"
    | "load_balancer"
    | "session_store"
    | "circuit_breaker"
    | "mesh_sidecar"
    | "mesh_control"
    | "region",
    Readonly<Record<string, FieldSpec>>
  >
> = {
  app_instance: {
    health: HEALTH,
    status: STATUS3,
    inRotation: bool("로테이션에 있음"),
    drained: bool("빼 둠(drain)"),
  },
  load_balancer: { health: HEALTH, status: STATUS3 },
  session_store: { health: HEALTH, status: STATUS2 },
  circuit_breaker: {
    health: HEALTH,
    mode: { label: "상태", type: "enum", values: ["closed", "open", "half-open"] },
    trips: num("열린 횟수", "회"),
  },
  mesh_sidecar: { health: HEALTH, status: STATUS2 },
  mesh_control: {
    health: HEALTH,
    status: STATUS2,
    retries: { label: "재시도 설정", type: "enum", values: ["sane", "aggressive"] },
  },
  region: { health: HEALTH, status: STATUS2, lagS: num("복제 지연", "초") },
};

/** The condition fields of every layer-specific entity kind (database, SDN, containers, application). */
export const LAYER_CONDITION_FIELDS = {
  ...DB_CONDITION_FIELDS,
  ...SDN_CONDITION_FIELDS,
  ...K8S_CONDITION_FIELDS,
  ...APP_CONDITION_FIELDS,
};
