/**
 * The route table: one list both sides read. The server registers exactly these routes and parses
 * bodies and queries with these schemas; the web client builds its calls from the same entries, so a
 * renamed field or path breaks the type check instead of a user's click.
 */

import type { z } from "zod";
import { AUDIT_ROUTES } from "./audit-routes";
import { COMMUNITY_ROUTES } from "./community-routes";
import { CONNECTION_ROUTES } from "./connection-routes";
import { MODEL_ROUTES } from "./model-routes";
import { MOSS_ROUTES } from "./moss-routes";
import type { RoutePolicy } from "./permissions";
import { PHYSICS_ROUTES } from "./physics-routes";
import { ImportPresetsBody, PresetQuery, RenamePresetBody, SavePresetBody } from "./presets";
import { PROCESS_ROUTES } from "./process-routes";
import {
  AddRunsBody,
  CreateExperimentBody,
  CreateScenarioBody,
  CreateShareBody,
  CreateWorldBody,
  DryRunBody,
  EscalationAnswerBody,
  ExperimentQuery,
  ForkBody,
  GenerateWorldBody,
  ImportWorldBody,
  LeaderboardQuery,
  ReportQuery,
  RunEventsQuery,
  ScenarioQuery,
  TwinQuery,
  UpdateScenarioBody,
  UpdateWorldBody,
} from "./requests";
import { SERVICE_CARD_ROUTES } from "./service-card-routes";
import { SHARE_ROUTES } from "./share-routes";

export type { Responses } from "./responses";

export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
/** What the response body is; anything but json is a document to show or download. */
export type Produces = "json" | "html" | "markdown" | "text" | "jsonl" | "sse";

export interface RouteSpec {
  readonly method: Method;
  readonly path: string;
  readonly summary: string;
  readonly body?: z.ZodTypeAny;
  readonly query?: z.ZodTypeAny;
  readonly produces: Produces;
  /** Reachable without the app (share links): the address itself is the secret. */
  readonly public?: boolean;
  /**
   * Who may call it, said once here (ADR-0174). Every route that is not `public` declares one, and a test
   * fails for a route that does not. `open` answers whoever the identity method lets through (it says who
   * they are); `signedIn` and `admin` are enforced for every request before the handler runs; `{ action }`
   * names the one thing the handler decides with `may` once it has found what the request is about.
   */
  readonly policy?: RoutePolicy;
}

const json = "json" as const;

export const ROUTES = {
  meta: {
    method: "GET",
    path: "/api/meta",
    summary: "누구인지, 하네스·소스·대기열 상태",
    produces: json,
    policy: "open",
  },

  ...CONNECTION_ROUTES,

  listPresets: {
    method: "GET",
    path: "/api/presets",
    summary: "저장해 둔 지시문·툴 묶음·절차서와, 7일 안에 되돌릴 수 있게 지운 것 (내 것만)",
    query: PresetQuery,
    produces: json,
    policy: "signedIn",
  },
  savePreset: {
    method: "POST",
    path: "/api/presets",
    summary: "이름 붙여 저장 (같은 종류에서 같은 이름이면 내용을 바꿔요)",
    body: SavePresetBody,
    produces: json,
    policy: "signedIn",
  },
  importPresets: {
    method: "POST",
    path: "/api/presets/import",
    summary: "이 브라우저에 있던 것을 서버로 한 번 옮기기 (이미 있는 이름은 건너뛰어요)",
    body: ImportPresetsBody,
    produces: json,
    policy: "signedIn",
  },
  renamePreset: {
    method: "PUT",
    path: "/api/presets/:id",
    summary: "저장해 둔 것의 이름 바꾸기",
    body: RenamePresetBody,
    produces: json,
    policy: "signedIn",
  },
  deletePreset: {
    method: "DELETE",
    path: "/api/presets/:id",
    summary: "저장해 둔 것 지우기 (7일 안에는 되돌릴 수 있어요)",
    produces: json,
    policy: "signedIn",
  },
  restorePreset: {
    method: "POST",
    path: "/api/presets/:id/restore",
    summary: "지운 것 되돌리기",
    produces: json,
    policy: "signedIn",
  },

  ...MODEL_ROUTES,
  ...MOSS_ROUTES,
  ...PHYSICS_ROUTES,
  ...COMMUNITY_ROUTES,
  ...SERVICE_CARD_ROUTES,
  ...PROCESS_ROUTES,
  ...SHARE_ROUTES,
  ...AUDIT_ROUTES,

  listWorldTemplates: {
    method: "GET",
    path: "/api/world-templates",
    summary: "저장해 둔 세계 템플릿 목록",
    produces: json,
    policy: "signedIn",
  },
  getWorld: {
    method: "GET",
    path: "/api/worlds/:id",
    summary: "세계 하나 (blueprint 포함)",
    produces: json,
    policy: "signedIn",
  },
  createWorld: {
    method: "POST",
    path: "/api/worlds",
    summary: "빌더에서 지은 세계 저장",
    body: CreateWorldBody,
    produces: json,
    policy: "signedIn",
  },
  generateWorld: {
    method: "POST",
    path: "/api/worlds/generate",
    summary: "사업장 프리셋으로 세계 생성",
    body: GenerateWorldBody,
    produces: json,
    policy: "signedIn",
  },
  importWorld: {
    method: "POST",
    path: "/api/worlds/import",
    summary: "현실(KG 등)에서 읽기 전용으로 가져오기 (관리자만)",
    body: ImportWorldBody,
    produces: json,
    policy: "admin",
  },
  updateWorld: {
    method: "PUT",
    path: "/api/worlds/:id",
    summary: "세계 고쳐 저장 (버전 확인)",
    body: UpdateWorldBody,
    produces: json,
    policy: { action: "change" },
  },
  deleteWorld: {
    method: "DELETE",
    path: "/api/worlds/:id",
    summary: "세계 숨기기 (실험이 쓴 버전은 남아요)",
    produces: json,
    policy: { action: "remove" },
  },

  listScenarios: {
    method: "GET",
    path: "/api/scenarios",
    summary: "시나리오 목록",
    query: ScenarioQuery,
    produces: json,
    policy: "signedIn",
  },
  getScenario: {
    method: "GET",
    path: "/api/scenarios/:id",
    summary: "시나리오 하나",
    produces: json,
    policy: "signedIn",
  },
  createScenario: {
    method: "POST",
    path: "/api/scenarios",
    summary: "새 시나리오 (빈 것, 템플릿, 문서)",
    body: CreateScenarioBody,
    produces: json,
    policy: "signedIn",
  },
  updateScenario: {
    method: "PUT",
    path: "/api/scenarios/:id",
    summary: "시나리오 고쳐 저장 (버전 확인)",
    body: UpdateScenarioBody,
    produces: json,
    policy: { action: "change" },
  },
  deleteScenario: {
    method: "DELETE",
    path: "/api/scenarios/:id",
    summary: "시나리오 숨기기",
    produces: json,
    policy: { action: "remove" },
  },
  dryRunScenario: {
    method: "POST",
    path: "/api/scenarios/:id/dry-run",
    summary: "에이전트 없이 미리 보기",
    body: DryRunBody,
    produces: json,
    policy: "signedIn",
  },
  calibrateScenario: {
    method: "POST",
    path: "/api/scenarios/:id/calibrate",
    summary:
      "시험지 점검: 아무것도 안 하는·찍는·정답만 아는 에이전트로 점수 재 보기 (시나리오를 만든 사람과 관리자)",
    body: DryRunBody,
    produces: json,
    policy: { action: "calibrate" },
  },

  listExperiments: {
    method: "GET",
    path: "/api/experiments",
    summary: "실험 목록 (최신순)",
    query: ExperimentQuery,
    produces: json,
    policy: "signedIn",
  },
  getExperiment: {
    method: "GET",
    path: "/api/experiments/:id",
    summary: "실험 하나: 실행, 분석, 계보",
    produces: json,
    policy: "signedIn",
  },
  createExperiment: {
    method: "POST",
    path: "/api/experiments",
    summary: "실험 만들고 대기열에 더하기",
    body: CreateExperimentBody,
    produces: json,
    policy: { action: "use" },
  },
  cancelExperiment: {
    method: "POST",
    path: "/api/experiments/:id/cancel",
    summary: "남은 실행 멈추기",
    produces: json,
    policy: { action: "cancel" },
  },
  forkExperiment: {
    method: "POST",
    path: "/api/experiments/:id/fork",
    summary: "조건만 바꿔 다시 실행",
    body: ForkBody,
    produces: json,
    policy: { action: "use" },
  },
  addRuns: {
    method: "POST",
    path: "/api/experiments/:id/runs",
    summary: "같은 조건으로 실행 더하기",
    body: AddRunsBody,
    produces: json,
    policy: { action: "addRuns" },
  },
  experimentEvents: {
    method: "GET",
    path: "/api/experiments/:id/events",
    summary: "진행 상황 실시간 (SSE)",
    produces: "sse",
    policy: "signedIn",
  },
  worldActivity: {
    method: "GET",
    path: "/api/worlds/:id/activity",
    summary: "이 세계에서 지금 일하는 에이전트들 (SSE)",
    produces: "sse",
    policy: "signedIn",
  },
  experimentReport: {
    method: "GET",
    path: "/api/experiments/:id/report",
    summary: "보고서 (HTML·Markdown·텍스트)",
    query: ReportQuery,
    produces: "html",
    policy: "signedIn",
  },
  experimentDiagnoses: {
    method: "GET",
    path: "/api/experiments/:id/diagnoses",
    summary: "진단 기록 (JSON Lines)",
    produces: "jsonl",
    policy: "signedIn",
  },
  createShare: {
    method: "POST",
    path: "/api/experiments/:id/shares",
    summary: "공유 링크 만들기 (실험을 만든 사람과 관리자. 기간을 안 적으면 30일)",
    body: CreateShareBody,
    produces: json,
    policy: { action: "createShare" },
  },
  deleteShare: {
    method: "DELETE",
    path: "/api/shares/:token",
    summary: "공유 링크 끊기",
    produces: json,
    policy: { action: "deleteShare" },
  },

  getRun: {
    method: "GET",
    path: "/api/runs/:id",
    summary: "실행 하나: 결과, 분석, 타임라인",
    produces: json,
    policy: "signedIn",
  },
  runbookDraft: {
    method: "GET",
    path: "/api/scenarios/:id/runbook-draft",
    summary: "최고 점수 실행의 툴 호출 순서로 만든 절차서 초안",
    produces: json,
    policy: "signedIn",
  },
  listEscalations: {
    method: "GET",
    path: "/api/escalations",
    summary: "사람을 기다리는 실행들 (에이전트가 ask_human으로 물은 것)",
    produces: json,
    policy: "signedIn",
  },
  answerEscalation: {
    method: "POST",
    path: "/api/runs/:id/escalation",
    summary: "기다리는 실행에 답하기: 글로 답, 대신 조치, 툴 더 주기, 끝내기",
    body: EscalationAnswerBody,
    produces: json,
    policy: { action: "answerEscalation" },
  },
  runEvents: {
    method: "GET",
    path: "/api/runs/:id/events",
    summary: "실행의 불변 사건 기록 (세계 시간·실제 시간), 구간은 from·to",
    query: RunEventsQuery,
    produces: json,
    policy: "signedIn",
  },
  runWorld: {
    method: "GET",
    path: "/api/runs/:id/world",
    summary: "실행이 돌았던 때의 세계 (그 버전 그대로)",
    produces: json,
    policy: "signedIn",
  },
  runTelemetry: {
    method: "GET",
    path: "/api/runs/:id/telemetry",
    summary: "하네스 트레이스·로그·메트릭 (ClickStack)",
    produces: json,
    policy: "signedIn",
  },

  leaderboards: {
    method: "GET",
    path: "/api/leaderboards",
    summary: "벤치마크 세트별 순위",
    query: LeaderboardQuery,
    produces: json,
    policy: "signedIn",
  },

  twinDiagnoses: {
    method: "GET",
    path: "/api/twin/diagnoses",
    summary: "모든 진단 기록 (JSON Lines)",
    query: TwinQuery,
    produces: "jsonl",
    policy: "signedIn",
  },
  twinBrief: {
    method: "GET",
    path: "/api/twin/brief",
    summary: "시뮬레이터 모델링 브리프 (Markdown)",
    query: TwinQuery,
    produces: "markdown",
    policy: "signedIn",
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
