/** 실험을 누가 볼 수 있는지와 공유 링크 목록의 경로(ADR-0174). routes.ts의 표에 펼쳐 넣어요. */
import type { RouteSpec } from "./routes";
import { ScopeBody } from "./scope";

const json = "json" as const;

/** The one route that changes who can see a thing: the same shape for all five kinds, and no other route does it. */
const scopeRoute = (path: string, what: string) =>
  ({
    method: "PUT",
    path,
    summary: `${what}을 누가 볼 수 있는지 바꾸기 (만든 사람과 관리자). 이름·내용은 건드리지 않아요`,
    body: ScopeBody,
    produces: json,
    policy: { action: "changeScope" },
  }) as const;

export const SHARE_ROUTES = {
  setWorldScope: scopeRoute("/api/worlds/:id/scope", "세계"),
  setScenarioScope: scopeRoute("/api/scenarios/:id/scope", "시나리오"),
  setConnectionScope: scopeRoute("/api/connections/:id/scope", "연결"),
  setModelScope: scopeRoute("/api/models/:id/scope", "모델 등록"),
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
