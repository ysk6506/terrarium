/** 실험을 누가 볼 수 있는지와 공유 링크 목록의 경로(ADR-0174). routes.ts의 표에 펼쳐 넣어요. */
import type { RouteSpec } from "./routes";
import { ScopeBody } from "./scope";

const json = "json" as const;

export const SHARE_ROUTES = {
  setExperimentScope: {
    method: "PUT",
    path: "/api/experiments/:id/scope",
    summary: "실험을 누가 볼 수 있는지 바꾸기 (만든 사람과 관리자). 딸린 실행·보고서도 따라가요",
    body: ScopeBody,
    produces: json,
    policy: { action: "changeScope" },
  },
  listShares: {
    method: "GET",
    path: "/api/experiments/:id/shares",
    summary: "이 실험의 공유 링크 목록 (만든 사람과 관리자)",
    produces: json,
    policy: { action: "listShares" },
  },
} as const satisfies Record<string, RouteSpec>;
