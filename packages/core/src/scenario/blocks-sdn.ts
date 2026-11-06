/** The fields a condition can test on the SDN overlay and cloud-native network entities (REQ-097). */
import { bool, type FieldSpec, HEALTH, num } from "./field-spec";

const STATUS3: FieldSpec = { label: "상태", type: "enum", values: ["ok", "degraded", "down"] };

export const SDN_CONDITION_FIELDS: Readonly<
  Record<
    | "sdn_controller"
    | "vtep"
    | "overlay_segment"
    | "nfv_function"
    | "cni"
    | "network_policy"
    | "ingress",
    Readonly<Record<string, FieldSpec>>
  >
> = {
  sdn_controller: {
    health: HEALTH,
    role: { label: "역할", type: "enum", values: ["active", "standby"] },
    status: { label: "상태", type: "enum", values: ["ok", "down"] },
    managed: num("관리하는 스위치", "대"),
  },
  vtep: {
    health: HEALTH,
    evpn: { label: "EVPN 세션", type: "enum", values: ["established", "down"] },
    cut: bool("세그먼트에서 끊김"),
    flaps: num("세션 플랩", "회"),
  },
  overlay_segment: { health: HEALTH, status: STATUS3 },
  nfv_function: { health: HEALTH, status: STATUS3, latencyMs: num("지연", "ms") },
  cni: { health: HEALTH, status: { label: "상태", type: "enum", values: ["ok", "down"] } },
  network_policy: {
    health: HEALTH,
    rule: { label: "규칙", type: "enum", values: ["allow", "deny"] },
  },
  ingress: { health: HEALTH, status: STATUS3 },
};
