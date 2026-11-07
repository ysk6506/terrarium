/** 서비스 카드 네 경로와 빠른 실험(REQ-104, ADR-0127). routes.ts의 표에 펼쳐 넣어요. */

import type { RouteSpec } from "./routes";
import { CreateServiceCardBody, QuickExperimentBody, UpdateServiceCardBody } from "./service-cards";

const json = "json" as const;

export const SERVICE_CARD_ROUTES = {
  listServiceCards: {
    method: "GET",
    path: "/api/service-cards",
    summary: "내 카드와 사람들이 공유한 카드 (만든 사람과 칭호가 실려 와요)",
    produces: json,
  },
  createServiceCard: {
    method: "POST",
    path: "/api/service-cards",
    summary: "서비스를 내 카드로 저장 (기본 제공 카드 + 이름·피해 숫자). 처음엔 잠김, 공유 안 함",
    body: CreateServiceCardBody,
    produces: json,
  },
  updateServiceCard: {
    method: "PATCH",
    path: "/api/service-cards/:id",
    summary: "카드 고치기 (만든 사람만. 잠기지 않은 카드는 누구나 이름·피해 숫자만)",
    body: UpdateServiceCardBody,
    produces: json,
  },
  deleteServiceCard: {
    method: "DELETE",
    path: "/api/service-cards/:id",
    summary: "카드 지우기 (만든 사람만)",
    produces: json,
  },
  quickExperiment: {
    method: "POST",
    path: "/api/worlds/:id/quick-experiment",
    summary:
      "권장값으로 실험 시작 한 번: 이 세계에 맞는 시나리오 전부(운영 세트), 기본 툴, 5번, 최근 쓴 에이전트(없으면 내장 operator), 실제 시간",
    body: QuickExperimentBody,
    produces: json,
  },
} as const satisfies Record<string, RouteSpec>;
