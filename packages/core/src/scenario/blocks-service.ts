/** What a condition can ask about a service (REQ-086, ADR-0091): how it is doing and what its stops cost. */
import { type FieldSpec, HEALTH, num } from "./field-spec";

export const SERVICE_FIELDS: Readonly<Record<string, FieldSpec>> = {
  health: HEALTH,
  status: { label: "서비스 상태", type: "enum", values: ["healthy", "degraded", "down"] },
  backlog: num("밀린 일", "건"),
  lostKrw: num("지금까지 본 피해(추정)", "원"),
  failovers: num("대기 쪽으로 옮긴 수", "번"),
};
