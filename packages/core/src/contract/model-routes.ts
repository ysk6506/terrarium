/** LLM API 등록의 여섯 경로(REQ-099, ADR-0119). routes.ts의 표에 펼쳐 넣어요. */
import { CreateModelBody, UpdateModelBody } from "./models";
import type { RouteSpec } from "./routes";

const json = "json" as const;

export const MODEL_ROUTES = {
  listModels: {
    method: "GET",
    path: "/api/models",
    summary: "워크스페이스에 등록한 LLM API 목록 (키는 마지막 네 글자만)",
    produces: json,
  },
  createModel: {
    method: "POST",
    path: "/api/models",
    summary: "LLM API 등록 (litellm·openai·anthropic). 첫 번째는 기본이 돼요",
    body: CreateModelBody,
    produces: json,
  },
  updateModel: {
    method: "PATCH",
    path: "/api/models/:id",
    summary: "등록 고치기 (만든 사람만). 키를 비워 두면 기존 키가 남아요",
    body: UpdateModelBody,
    produces: json,
  },
  deleteModel: {
    method: "DELETE",
    path: "/api/models/:id",
    summary: "등록 지우기 (만든 사람만). 저장한 키도 지워져요",
    produces: json,
  },
  checkModel: {
    method: "POST",
    path: "/api/models/:id/check",
    summary: "연결 확인: 모델 목록을 읽고, 안 되면 한 토큰짜리 짧은 호출로 다시 확인",
    produces: json,
  },
  setDefaultModel: {
    method: "POST",
    path: "/api/models/:id/default",
    summary: "기본 모델로 정하기 (나중에 쓰는 기능은 기본 모델을 써요)",
    produces: json,
  },
} as const satisfies Record<string, RouteSpec>;
