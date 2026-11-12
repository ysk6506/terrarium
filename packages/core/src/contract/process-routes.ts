/** 프로세스 비교의 네 경로 (REQ-112, ADR-0135). routes.ts의 표에 펼쳐 넣어요. */

import { PutCurrentProcessBody, WorldOntologyQuery } from "./process";
import type { RouteSpec } from "./routes";

const json = "json" as const;

export const PROCESS_ROUTES = {
  getCurrentProcess: {
    method: "GET",
    path: "/api/scenarios/:id/current-process",
    summary: '시나리오의 "지금 하는 방식" 표 (적은 값. 아직 안 적었으면 비어 있어요)',
    produces: json,
    policy: "signedIn",
  },
  putCurrentProcess: {
    method: "PUT",
    path: "/api/scenarios/:id/current-process",
    summary: '"지금 하는 방식" 표 저장 (시나리오를 만든 사람과 관리자만)',
    body: PutCurrentProcessBody,
    produces: json,
    policy: { action: "editProcess" },
  },
  experimentProcess: {
    method: "GET",
    path: "/api/experiments/:id/process",
    summary:
      "실험의 전후 비교: 실행의 기록에서 코드가 센 단계·사람·시간(평균), 적은 표와의 차이, 대표 실행의 단계 장부",
    produces: json,
    policy: "signedIn",
  },
  worldOntology: {
    method: "GET",
    path: "/api/worlds/:id/ontology",
    summary:
      "이 세계에 필요한 액션: 시나리오 정의에서 뽑은 객체·링크·액션 요구, 고른 실험에서 실제로 쓴 것",
    query: WorldOntologyQuery,
    produces: json,
    policy: "signedIn",
  },
} as const satisfies Record<string, RouteSpec>;
