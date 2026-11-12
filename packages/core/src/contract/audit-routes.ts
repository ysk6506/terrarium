/** 감사 기록을 읽는 길 셋(ADR-0193). routes.ts의 표에 펼쳐 넣어요. */
import { AuditExportQuery, AuditMineQuery, AuditQuery } from "./audit";
import type { RouteSpec } from "./routes";

export const AUDIT_ROUTES = {
  listAudit: {
    method: "GET",
    path: "/api/audit",
    summary:
      "감사 기록 목록 (관리자만). 시간·누가·무엇을·종류·결과로 거르고 새것부터, 쪽 나눠 줘요",
    query: AuditQuery,
    produces: "json",
    policy: "admin",
  },
  exportAudit: {
    method: "GET",
    path: "/api/audit/export",
    summary:
      "감사 기록 내려받기 (관리자만, JSON Lines). 같은 거르기를 쓰고 새것부터 5만 줄까지예요",
    query: AuditExportQuery,
    produces: "jsonl",
    policy: "admin",
  },
  listAuditMine: {
    method: "GET",
    path: "/api/audit/mine",
    summary:
      "내 것에 누가 무엇을 했나 (로그인한 누구나, 내가 만든 것만): 누가·언제·무엇을·결과만 줘요",
    query: AuditMineQuery,
    produces: "json",
    policy: "signedIn",
  },
} as const satisfies Record<string, RouteSpec>;
