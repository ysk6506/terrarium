/** 연결(하네스·에이전트)과 에이전트 버전의 경로(REQ-051, REQ-053). routes.ts의 표에 펼쳐 넣어요. */
import {
  AddAgentVersionBody,
  CheckConnectionBody,
  CreateConnectionBody,
  EditAgentVersionBody,
  TryConnectionBody,
  UpdateConnectionBody,
} from "./requests";
import type { RouteSpec } from "./routes";

const json = "json" as const;

export const CONNECTION_ROUTES = {
  listConnectors: {
    method: "GET",
    path: "/api/connectors",
    summary: "연결할 수 있는 프로토콜(커넥터)과 그 입력 칸",
    produces: json,
    policy: "signedIn",
  },
  listTelemetryAdapters: {
    method: "GET",
    path: "/api/telemetry-adapters",
    summary: "트레이스를 쌓아 두는 곳(ClickStack, Langfuse)과 그 입력 칸, 서버의 기본값",
    produces: json,
    policy: "signedIn",
  },
  listConnections: {
    method: "GET",
    path: "/api/connections",
    summary: "연결된 하네스·에이전트와 발견된 에이전트",
    produces: json,
    policy: "signedIn",
  },
  checkConnection: {
    method: "POST",
    path: "/api/connections/check",
    summary: "저장하지 않고 연결해 보기 (발견된 에이전트, 걸린 시간, 실패 이유)",
    body: CheckConnectionBody,
    produces: json,
    policy: { action: "change" },
  },
  createConnection: {
    method: "POST",
    path: "/api/connections",
    summary: "하네스를 연결하거나 에이전트를 직접 등록",
    body: CreateConnectionBody,
    produces: json,
    policy: "signedIn",
  },
  updateConnection: {
    method: "PUT",
    path: "/api/connections/:id",
    summary: "연결 설정 바꾸기 (토큰은 비워 두면 그대로. 만든 사람만)",
    body: UpdateConnectionBody,
    produces: json,
    policy: { action: "change" },
  },
  tryConnection: {
    method: "POST",
    path: "/api/connections/:id/try",
    summary:
      "말 걸어 보기 — 에이전트에게 한 문장을 보내 답을 받는다 (한 턴, 툴 없음, 60초, 세계에 영향 없음)",
    body: TryConnectionBody,
    produces: json,
    policy: { action: "use" },
  },
  keepConnection: {
    method: "POST",
    path: "/api/connections/:id/keep",
    summary:
      "계속 쓰기 — 자동으로 지워질 때까지의 기간을 처음부터 다시 세어요 (만든 사람과 관리자)",
    produces: json,
    policy: { action: "use" },
  },
  recheckConnection: {
    method: "POST",
    path: "/api/connections/:id/check",
    summary: "연결된 것을 다시 확인해 에이전트 목록 새로 받기",
    produces: json,
    policy: { action: "use" },
  },
  deleteConnection: {
    method: "DELETE",
    path: "/api/connections/:id",
    summary: "연결 끊기 (만든 사람만. 설정 파일의 연결은 못 지워요)",
    produces: json,
    policy: { action: "remove" },
  },
  listAgentVersions: {
    method: "GET",
    path: "/api/connections/:id/agents/:agentId/versions",
    summary: "에이전트의 버전 목록 (바뀐 점·날짜)과, 지금 실험을 만들면 무엇이 달라질지",
    produces: json,
    policy: "signedIn",
  },
  addAgentVersion: {
    method: "POST",
    path: "/api/connections/:id/agents/:agentId/versions",
    summary: "사람이 버전을 직접 더하기 (이름표·메모·보이지 않는 차이를 속성으로)",
    body: AddAgentVersionBody,
    produces: json,
    policy: { action: "editAgentVersions" },
  },
  editAgentVersion: {
    method: "PUT",
    path: "/api/connections/:id/agents/:agentId/versions/:n",
    summary: "버전의 이름표·메모·속성 바꾸기",
    body: EditAgentVersionBody,
    produces: json,
    policy: { action: "editAgentVersions" },
  },
  deleteAgentVersion: {
    method: "DELETE",
    path: "/api/connections/:id/agents/:agentId/versions/:n",
    summary: "버전 지우기 (번호는 다시 쓰이지 않아요)",
    produces: json,
    policy: { action: "editAgentVersions" },
  },
} as const satisfies Record<string, RouteSpec>;
