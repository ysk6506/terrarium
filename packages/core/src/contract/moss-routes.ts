/** 이끼의 길 하나 (REQ-103, ADR-0124). routes.ts의 표에 펼쳐 넣어요. */
import { MossAskBody } from "./moss";
import type { RouteSpec } from "./routes";

export const MOSS_ROUTES = {
  askMoss: {
    method: "POST",
    path: "/api/moss/ask",
    summary:
      "이끼에게 묻기: 질문·화면 이름·화면 상태로 문서 조각을 찾고 기본 모델에 물어 {answer, sources, suggestedActions, followUps}를 받아요. 동작은 서버가 하지 않아요",
    body: MossAskBody,
    produces: "json",
  },
} as const satisfies Record<string, RouteSpec>;
