/**
 * The route table: one list both sides read. The server registers exactly these routes and parses
 * bodies and queries with these schemas; the web client builds its calls from the same entries, so a
 * renamed field or path breaks the type check instead of a user's click.
 */

import type { ScenarioRecord, WorldRecord } from "@terrarium/core/experiments";
import type { z } from "zod";
import {
  AddRunsBody,
  CreateExperimentBody,
  CreateScenarioBody,
  CreateShareBody,
  CreateWorldBody,
  DryRunBody,
  ExperimentQuery,
  ForkBody,
  GenerateWorldBody,
  ImportWorldBody,
  LeaderboardQuery,
  ReportQuery,
  ScenarioQuery,
  TwinQuery,
  UpdateScenarioBody,
  UpdateWorldBody,
} from "./requests";
import type {
  DryRunView,
  ExperimentSummary,
  ExperimentView,
  GeneratedWorld,
  ImportedWorld,
  LeaderboardView,
  MetaView,
  RunView,
  SavedScenario,
  SavedWorld,
  ShareView,
  TelemetryView,
  WorldSummary,
} from "./views";

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
    summary: "세계 숨기기 (실험이 쓴 버전은 남는다)",
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
    summary: "실험 만들고 대기열에 넣기",
    body: CreateExperimentBody,
    produces: json,
  },
  cancelExperiment: {
    method: "POST",
    path: "/api/experiments/:id/cancel",
    summary: "남은 실행 취소",
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
    summary: "같은 조건으로 실행 추가",
    body: AddRunsBody,
    produces: json,
  },
  experimentEvents: {
    method: "GET",
    path: "/api/experiments/:id/events",
    summary: "진행 상황 실시간 (SSE)",
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

/** JSON response of each route; document routes answer with text. */
export interface Responses {
  meta: MetaView;
  listWorlds: WorldSummary[];
  getWorld: WorldRecord;
  createWorld: SavedWorld;
  generateWorld: GeneratedWorld;
  importWorld: ImportedWorld;
  updateWorld: SavedWorld;
  deleteWorld: { readonly deleted: boolean };
  listScenarios: ScenarioRecord[];
  getScenario: ScenarioRecord;
  createScenario: SavedScenario;
  updateScenario: SavedScenario;
  deleteScenario: { readonly deleted: boolean };
  dryRunScenario: DryRunView;
  listExperiments: ExperimentSummary[];
  getExperiment: ExperimentView;
  createExperiment: ExperimentView;
  cancelExperiment: ExperimentView;
  forkExperiment: ExperimentView;
  addRuns: ExperimentView;
  experimentEvents: string;
  experimentReport: string;
  experimentDiagnoses: string;
  createShare: ShareView;
  deleteShare: { readonly deleted: boolean };
  getRun: RunView;
  runTelemetry: TelemetryView;
  leaderboards: LeaderboardView[];
  twinDiagnoses: string;
  twinBrief: string;
  sharedReport: string;
}

type Spec<N extends RouteName> = (typeof ROUTES)[N];
export type BodyOf<N extends RouteName> = Spec<N> extends { body: z.ZodTypeAny }
  ? z.input<Spec<N>["body"]>
  : undefined;
export type QueryOf<N extends RouteName> = Spec<N> extends { query: z.ZodTypeAny }
  ? z.input<Spec<N>["query"]>
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
    if (value === undefined || value === "") throw new Error(`${name}: '${key}' 값이 없다`);
    return encodeURIComponent(value);
  });
  const entries = Object.entries(query ?? {}).filter(([, v]) => v !== undefined && v !== "");
  if (entries.length === 0) return path;
  return `${path}?${new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString()}`;
}
