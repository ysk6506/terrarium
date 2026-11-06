/**
 * The route table: one list both sides read. The server registers exactly these routes and parses
 * bodies and queries with these schemas; the web client builds its calls from the same entries, so a
 * renamed field or path breaks the type check instead of a user's click.
 */

import type { z } from "zod";
import {
  AddAgentVersionBody,
  AddRunsBody,
  CheckConnectionBody,
  CreateConnectionBody,
  CreateExperimentBody,
  CreateScenarioBody,
  CreateShareBody,
  CreateWorldBody,
  DryRunBody,
  EditAgentVersionBody,
  EscalationAnswerBody,
  ExperimentQuery,
  ForkBody,
  GenerateWorldBody,
  ImportWorldBody,
  LeaderboardQuery,
  ReportQuery,
  RunEventsQuery,
  ScenarioQuery,
  TryConnectionBody,
  TwinQuery,
  UpdateConnectionBody,
  UpdateScenarioBody,
  UpdateWorldBody,
} from "./requests";

export type { Responses } from "./responses";

export type Method = "GET" | "POST" | "PUT" | "DELETE";
/** What the response body is; anything but json is a document to show or download. */
export type Produces = "json" | "html" | "markdown" | "text" | "jsonl" | "sse";

export interface RouteSpec {
  readonly method: Method;
  readonly path: string;
  readonly summary: string;
  readonly body?: z.ZodTypeAny;
  readonly query?: z.ZodTypeAny;
  readonly produces: Produces;
  /** Reachable without the app (share links). Everything else is for signed-in people. */
  readonly public?: boolean;
}

const json = "json" as const;

export const ROUTES = {
  meta: {
    method: "GET",
    path: "/api/meta",
    summary: "누구인지, 하네스·소스·대기열 상태",
    produces: json,
  },

  listConnectors: {
    method: "GET",
    path: "/api/connectors",
    summary: "연결할 수 있는 프로토콜(커넥터)과 그 입력 칸",
    produces: json,
  },
  listTelemetryAdapters: {
    method: "GET",
    path: "/api/telemetry-adapters",
    summary: "트레이스를 쌓아 두는 곳(ClickStack, Langfuse)과 그 입력 칸, 서버의 기본값",
    produces: json,
  },
  listConnections: {
    method: "GET",
    path: "/api/connections",
    summary: "연결된 하네스·에이전트와 발견된 에이전트",
    produces: json,
  },
  checkConnection: {
    method: "POST",
    path: "/api/connections/check",
    summary: "저장하지 않고 연결해 보기 (발견된 에이전트, 걸린 시간, 실패 이유)",
    body: CheckConnectionBody,
    produces: json,
  },
  createConnection: {
    method: "POST",
    path: "/api/connections",
    summary: "하네스를 연결하거나 에이전트를 직접 등록",
    body: CreateConnectionBody,
    produces: json,
  },
  updateConnection: {
    method: "PUT",
    path: "/api/connections/:id",
    summary: "연결 설정 바꾸기 (토큰은 비워 두면 그대로. 만든 사람만)",
    body: UpdateConnectionBody,
    produces: json,
  },
  tryConnection: {
    method: "POST",
    path: "/api/connections/:id/try",
    summary:
      "말 걸어 보기 — 에이전트에게 한 문장을 보내 답을 받는다 (한 턴, 툴 없음, 60초, 세계에 영향 없음)",
    body: TryConnectionBody,
    produces: json,
  },
  keepConnection: {
    method: "POST",
    path: "/api/connections/:id/keep",
    summary: "계속 쓰기 — 자동으로 지워질 때까지의 기간을 처음부터 다시 세어요 (쓰는 사람 누구나)",
    produces: json,
  },
  recheckConnection: {
    method: "POST",
    path: "/api/connections/:id/check",
    summary: "연결된 것을 다시 확인해 에이전트 목록 새로 받기",
    produces: json,
  },
  deleteConnection: {
    method: "DELETE",
    path: "/api/connections/:id",
    summary: "연결 끊기 (만든 사람만. 설정 파일의 연결은 못 지워요)",
    produces: json,
  },
  listAgentVersions: {
    method: "GET",
    path: "/api/connections/:id/agents/:agentId/versions",
    summary: "에이전트의 버전 목록 (바뀐 점·날짜)과, 지금 실험을 만들면 무엇이 달라질지",
    produces: json,
  },
  addAgentVersion: {
    method: "POST",
    path: "/api/connections/:id/agents/:agentId/versions",
    summary: "사람이 버전을 직접 더하기 (이름표·메모·보이지 않는 차이를 속성으로)",
    body: AddAgentVersionBody,
    produces: json,
  },
  editAgentVersion: {
    method: "PUT",
    path: "/api/connections/:id/agents/:agentId/versions/:n",
    summary: "버전의 이름표·메모·속성 바꾸기",
    body: EditAgentVersionBody,
    produces: json,
  },
  deleteAgentVersion: {
    method: "DELETE",
    path: "/api/connections/:id/agents/:agentId/versions/:n",
    summary: "버전 지우기 (번호는 다시 쓰이지 않아요)",
    produces: json,
  },

  listWorlds: { method: "GET", path: "/api/worlds", summary: "세계 목록", produces: json },
  getWorld: {
    method: "GET",
    path: "/api/worlds/:id",
    summary: "세계 하나 (blueprint 포함)",
    produces: json,
  },
  createWorld: {
    method: "POST",
    path: "/api/worlds",
    summary: "빌더에서 지은 세계 저장",
    body: CreateWorldBody,
    produces: json,
  },
  generateWorld: {
    method: "POST",
    path: "/api/worlds/generate",
    summary: "사업장 프리셋으로 세계 생성",
    body: GenerateWorldBody,
    produces: json,
  },
  importWorld: {
    method: "POST",
    path: "/api/worlds/import",
    summary: "현실(KG 등)에서 읽기 전용으로 가져오기",
    body: ImportWorldBody,
    produces: json,
  },
  updateWorld: {
    method: "PUT",
    path: "/api/worlds/:id",
    summary: "세계 고쳐 저장 (버전 확인)",
    body: UpdateWorldBody,
    produces: json,
  },
  deleteWorld: {
    method: "DELETE",
    path: "/api/worlds/:id",
    summary: "세계 숨기기 (실험이 쓴 버전은 남아요)",
    produces: json,
  },

  listScenarios: {
    method: "GET",
    path: "/api/scenarios",
    summary: "시나리오 목록",
    query: ScenarioQuery,
    produces: json,
  },
  getScenario: {
    method: "GET",
    path: "/api/scenarios/:id",
    summary: "시나리오 하나",
    produces: json,
  },
  createScenario: {
    method: "POST",
    path: "/api/scenarios",
    summary: "새 시나리오 (빈 것, 템플릿, 문서)",
    body: CreateScenarioBody,
    produces: json,
  },
  updateScenario: {
    method: "PUT",
    path: "/api/scenarios/:id",
    summary: "시나리오 고쳐 저장 (버전 확인)",
    body: UpdateScenarioBody,
    produces: json,
  },
  deleteScenario: {
    method: "DELETE",
    path: "/api/scenarios/:id",
    summary: "시나리오 숨기기",
    produces: json,
  },
  dryRunScenario: {
    method: "POST",
    path: "/api/scenarios/:id/dry-run",
    summary: "에이전트 없이 미리 돌려 보기",
    body: DryRunBody,
    produces: json,
  },
  calibrateScenario: {
    method: "POST",
    path: "/api/scenarios/:id/calibrate",
    summary: "시험지 점검: 아무것도 안 하는·찍는·정답만 아는 에이전트로 점수 재 보기",
    body: DryRunBody,
    produces: json,
  },

  listExperiments: {
    method: "GET",
    path: "/api/experiments",
    summary: "실험 목록 (최신순)",
    query: ExperimentQuery,
    produces: json,
  },
  getExperiment: {
    method: "GET",
    path: "/api/experiments/:id",
    summary: "실험 하나: 실행, 분석, 계보",
    produces: json,
  },
  createExperiment: {
    method: "POST",
    path: "/api/experiments",
    summary: "실험 만들고 대기열에 더하기",
    body: CreateExperimentBody,
    produces: json,
  },
  cancelExperiment: {
    method: "POST",
    path: "/api/experiments/:id/cancel",
    summary: "남은 실행 멈추기",
    produces: json,
  },
  forkExperiment: {
    method: "POST",
    path: "/api/experiments/:id/fork",
    summary: "조건만 바꿔 다시 실행",
    body: ForkBody,
    produces: json,
  },
  addRuns: {
    method: "POST",
    path: "/api/experiments/:id/runs",
    summary: "같은 조건으로 실행 더하기",
    body: AddRunsBody,
    produces: json,
  },
  experimentEvents: {
    method: "GET",
    path: "/api/experiments/:id/events",
    summary: "진행 상황 실시간 (SSE)",
    produces: "sse",
  },
  worldActivity: {
    method: "GET",
    path: "/api/worlds/:id/activity",
    summary: "이 세계에서 지금 일하는 에이전트들 (SSE)",
    produces: "sse",
  },
  experimentReport: {
    method: "GET",
    path: "/api/experiments/:id/report",
    summary: "보고서 (HTML·Markdown·텍스트)",
    query: ReportQuery,
    produces: "html",
  },
  experimentDiagnoses: {
    method: "GET",
    path: "/api/experiments/:id/diagnoses",
    summary: "진단 기록 (JSON Lines)",
    produces: "jsonl",
  },
  createShare: {
    method: "POST",
    path: "/api/experiments/:id/shares",
    summary: "공유 링크 만들기",
    body: CreateShareBody,
    produces: json,
  },
  deleteShare: {
    method: "DELETE",
    path: "/api/shares/:token",
    summary: "공유 링크 끊기",
    produces: json,
  },

  getRun: {
    method: "GET",
    path: "/api/runs/:id",
    summary: "실행 하나: 결과, 분석, 타임라인",
    produces: json,
  },
  runbookDraft: {
    method: "GET",
    path: "/api/scenarios/:id/runbook-draft",
    summary: "최고 점수 실행의 툴 호출 순서로 만든 절차서 초안",
    produces: json,
  },
  listEscalations: {
    method: "GET",
    path: "/api/escalations",
    summary: "사람을 기다리는 실행들 (에이전트가 ask_human으로 물은 것)",
    produces: json,
  },
  answerEscalation: {
    method: "POST",
    path: "/api/runs/:id/escalation",
    summary: "기다리는 실행에 답하기: 글로 답, 대신 조치, 툴 더 주기, 끝내기",
    body: EscalationAnswerBody,
    produces: json,
  },
  runEvents: {
    method: "GET",
    path: "/api/runs/:id/events",
    summary: "실행의 불변 사건 기록 (세계 시간·실제 시간), 구간은 from·to",
    query: RunEventsQuery,
    produces: json,
  },
  runWorld: {
    method: "GET",
    path: "/api/runs/:id/world",
    summary: "실행이 돌았던 때의 세계 (그 버전 그대로)",
    produces: json,
  },
  runTelemetry: {
    method: "GET",
    path: "/api/runs/:id/telemetry",
    summary: "하네스 트레이스·로그·메트릭 (ClickStack)",
    produces: json,
  },

  leaderboards: {
    method: "GET",
    path: "/api/leaderboards",
    summary: "벤치마크 세트별 순위",
    query: LeaderboardQuery,
    produces: json,
  },

  twinDiagnoses: {
    method: "GET",
    path: "/api/twin/diagnoses",
    summary: "모든 진단 기록 (JSON Lines)",
    query: TwinQuery,
    produces: "jsonl",
  },
  twinBrief: {
    method: "GET",
    path: "/api/twin/brief",
    summary: "시뮬레이터 모델링 브리프 (Markdown)",
    query: TwinQuery,
    produces: "markdown",
  },

  sharedReport: {
    method: "GET",
    path: "/r/:token",
    summary: "공유된 보고서 (앱 없이 열림)",
    query: ReportQuery,
    produces: "html",
    public: true,
  },
} as const satisfies Record<string, RouteSpec>;

export type RouteName = keyof typeof ROUTES;

type Spec<N extends RouteName> = (typeof ROUTES)[N];
export type BodyOf<N extends RouteName> = Spec<N> extends { body: z.ZodTypeAny }
  ? z.input<Spec<N>["body"]>
  : undefined;
export type QueryOf<N extends RouteName> = Spec<N> extends { query: z.ZodTypeAny }
  ? z.input<Spec<N>["query"]>
  : undefined;

/** Body and query after parsing (defaults filled in), as the server's handlers see them. */
export type ParsedBodyOf<N extends RouteName> = Spec<N> extends { body: z.ZodTypeAny }
  ? z.output<Spec<N>["body"]>
  : undefined;
export type ParsedQueryOf<N extends RouteName> = Spec<N> extends { query: z.ZodTypeAny }
  ? z.output<Spec<N>["query"]>
  : undefined;

/** `:name` segments of a path. */
export function paramNames(path: string): string[] {
  return [...path.matchAll(/:([A-Za-z]+)/g)].map((m) => m[1] as string);
}

/** A concrete path for a route; every `:param` must be given and is URL-encoded. */
export function pathFor(
  name: RouteName,
  params: Readonly<Record<string, string>> = {},
  query?: Readonly<Record<string, unknown>>,
): string {
  const route = ROUTES[name];
  const path = route.path.replace(/:([A-Za-z]+)/g, (_, key: string) => {
    const value = params[key];
    if (value === undefined || value === "") throw new Error(`${name}: '${key}' 값이 없어요`);
    return encodeURIComponent(value);
  });
  const entries = Object.entries(query ?? {}).filter(([, v]) => v !== undefined && v !== "");
  if (entries.length === 0) return path;
  return `${path}?${new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString()}`;
}
