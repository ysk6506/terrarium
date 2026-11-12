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
    policy: "signedIn",
  },
  createModel: {
    method: "POST",
    path: "/api/models",
    summary: "LLM API 등록 (litellm·openai·anthropic). 첫 번째는 기본이 돼요",
    body: CreateModelBody,
    produces: json,
    policy: "signedIn",
  },
  updateModel: {
    method: "PATCH",
    path: "/api/models/:id",
    summary: "등록 고치기 (만든 사람만). 키를 비워 두면 기존 키가 남아요",
    body: UpdateModelBody,
    produces: json,
    policy: { action: "change" },
  },
  deleteModel: {
    method: "DELETE",
    path: "/api/models/:id",
    summary: "등록 지우기 (만든 사람만). 저장한 키도 지워져요",
    produces: json,
    policy: { action: "remove" },
  },
  checkModel: {
    method: "POST",
    path: "/api/models/:id/check",
    summary:
      "연결 확인: 모델 목록을 읽고, 안 되면 한 토큰짜리 짧은 호출로 다시 확인 (등록한 사람과 관리자)",
    produces: json,
    policy: { action: "use" },
  },
  setDefaultModel: {
    method: "POST",
    path: "/api/models/:id/default",
    summary:
      "모두의 기본 모델로 정하기 (관리자와 그 모델의 주인만. 범위가 모두인 모델만 될 수 있어요)",
    produces: json,
    policy: { action: "change" },
  },
} as const satisfies Record<string, RouteSpec>;
