import { forkExperiment } from "@terrarium/core/experiments";
import { describe, expect, test } from "vitest";
import {
  analyzeExperiment,
  analyzeRun,
  buildLeaderboards,
  clearlyDifferent,
  MIN_RUNS_TO_RANK,
  NO_TELEMETRY,
  ratio,
  type Span,
  spanKind,
  summarize,
  type Telemetry,
  tCritical,
  usageOf,
} from ".";
import { experimentOf, SCRIPTS, snapshotFor } from "./test-support/runs";

const span = (id: string, attributes: Span["attributes"], extra: Partial<Span> = {}): Span => ({
  traceId: "t1",
  spanId: id,
  name: id,
  start: 1_000,
  end: 3_000,
  status: "ok",
  attributes,
  ...extra,
});

const trace: Telemetry = {
  spans: [
    span("agent", { "gen_ai.operation.name": "invoke_agent" }, { start: 0, end: 10_000 }),
    span("llm-1", {
      "gen_ai.operation.name": "chat",
      "gen_ai.request.model": "gauss-2",
      "gen_ai.usage.input_tokens": 1200,
      "gen_ai.usage.output_tokens": 300,
    }),
    span("llm-2", { "gen_ai.request.model": "gauss-2", "gen_ai.usage.input_tokens": "800" }),
    span("tool", { "gen_ai.tool.name": "list_alarms" }, { status: "error" }),
    span("http", { "http.method": "GET" }),
  ],
  logs: [{ time: 1, level: "error", message: "retry", attributes: {} }],
  metrics: [],
};

describe("one run, analysed [REQ-037]", () => {
  test("a correct diagnosis: score, timing, tool use and when the answer was first looked at", () => {
    const { runs } = experimentOf({ id: "e1", runs: [SCRIPTS.good] });
    const a = analyzeRun(runs[0] as (typeof runs)[number]);
    expect(a).toMatchObject({
      status: "completed",
      score: 100,
      passed: true,
      endReason: "diagnosed",
      diagnosis: { submitted: true, root: true, type: true, afterSeconds: 60 },
      efficiency: { investigationCalls: 2, failedCalls: 0, simSeconds: 60 },
      behaviour: { toolUse: { list_alarms: 1, get_impact: 1, submit_diagnosis: 1 }, repeated: 0 },
    });
    expect(a.behaviour.firstTouchSeconds).toBe(30);
    expect(a.findings).toEqual([]);
  });

  test("findings tell a half-right answer from a wrong one, and point at the evidence", () => {
    const { runs } = experimentOf({
      id: "e1",
      runs: [SCRIPTS.partial, SCRIPTS.wrong, SCRIPTS.silent],
    });
    const [partial, wrong, silent] = runs.map((r) => analyzeRun(r));
    expect(partial?.diagnosis).toMatchObject({ root: true, type: false });
    expect(partial?.findings.join("\n")).toContain("진단이 일부만 맞았다");
    expect(wrong?.findings.join("\n")).toContain("진단이 틀렸다");
    expect(wrong?.efficiency.failedCalls).toBe(2);
    expect(wrong?.findings.join("\n")).toContain(
      "정답 장비(crah-1)를 한 번도 직접 살펴보지 않았다",
    );
    expect(silent?.diagnosis.submitted).toBe(false);
    expect(silent?.findings[0]).toBe("진단을 제출하지 않았다 (종료: 진단 없이 종료)");
  });

  test("runs that never finished say why", () => {
    const { runs } = experimentOf({ id: "e1", runs: ["fail", "cancel"] });
    const [failed, cancelled] = runs.map((r) => analyzeRun(r));
    expect(failed).toMatchObject({ status: "failed", score: null, passed: false });
    expect(failed?.findings).toEqual(["실행이 실패했다: 하네스 연결 끊김"]);
    expect(cancelled?.findings).toEqual(["실행이 취소됐다"]);
  });

  test("the harness's trace adds model calls and tokens; what the harness reported wins", () => {
    expect(spanKind(trace.spans[0] as Span)).toBe("agent");
    expect(trace.spans.map(spanKind)).toEqual(["agent", "llm", "llm", "tool", "other"]);
    expect(usageOf(trace)).toEqual({
      llmCalls: 2,
      llmSeconds: 4,
      inputTokens: 2000,
      outputTokens: 300,
      models: ["gauss-2"],
      errors: 1,
      wallSeconds: 10,
      errorLogs: 1,
    });
    expect(usageOf(NO_TELEMETRY)).toMatchObject({ llmCalls: 0, wallSeconds: 0 });

    const traced = experimentOf({ id: "e1", runs: [SCRIPTS.good], harness: { traceId: "t1" } });
    const withTrace = analyzeExperiment({ ...traced, telemetry: new Map([["t1", trace]]) });
    expect(withTrace.runs[0]?.efficiency).toMatchObject({
      inputTokens: 2000,
      outputTokens: 300,
      llmCalls: 2,
      llmSeconds: 4,
      wallSeconds: 10,
    });
    const reported = experimentOf({
      id: "e1",
      runs: [SCRIPTS.good],
      harness: { traceId: "t1", inputTokens: 5000, costUsd: 0.02 },
    });
    const own = analyzeExperiment({ ...reported, telemetry: new Map([["t1", trace]]) });
    expect(own.runs[0]?.efficiency).toMatchObject({
      inputTokens: 5000,
      outputTokens: 300,
      costUsd: 0.02,
    });
    expect(own.tokens?.mean).toBe(5300);
    // Without a trace, nothing is made up.
    const bare = analyzeRun(experimentOf({ id: "e1", runs: [SCRIPTS.good] }).runs[0] as never);
    expect(bare.efficiency.inputTokens).toBeUndefined();
    expect(bare.efficiency.llmCalls).toBeUndefined();
  });
});

describe("an experiment across its runs [REQ-037]", () => {
  test("pass rate, accuracy and spread over completed runs; failures counted apart", () => {
    const input = experimentOf({
      id: "e1",
      runs: [SCRIPTS.good, SCRIPTS.wrong, SCRIPTS.good, "fail"],
    });
    const a = analyzeExperiment(input);
    expect(a.status).toBe("completed");
    expect(a.progress).toMatchObject({ total: 4, completed: 3, failed: 1 });
    expect(a.passRate).toBe(0.6667);
    expect(a.diagnosisRate).toBe(0.6667);
    expect(a.score).toMatchObject({ n: 3, max: 100 });
    expect(a.score?.ci95).toBeGreaterThan(0);
    expect(a.endReasons).toEqual({ diagnosed: 3 });
    const diagnosis = a.criteria.find((c) => c.kind === "diagnosis");
    expect(diagnosis).toMatchObject({ rate: 0.6667, max: expect.any(Number) });
    expect(a.findings[0]).toBe("3번 중 2번 합격 (67%)");
    expect(a.findings.some((f) => f.startsWith("실행마다 점수가 크게 다르다"))).toBe(true);
    expect(a.findings.some((f) => f.startsWith("진단까지 평균"))).toBe(true);
  });

  test("criteria most runs missed and endings other than a diagnosis are called out", () => {
    const a = analyzeExperiment(experimentOf({ id: "e1", runs: [SCRIPTS.silent, SCRIPTS.silent] }));
    expect(a.passRate).toBe(0);
    expect(a.timeToDiagnosis).toBeUndefined();
    expect(a.findings).toContain("2번은 진단 없이 종료로 끝났다");
    expect(a.findings.some((f) => /^'.+' 항목을 100%의 실행에서 놓쳤다$/.test(f))).toBe(true);
  });

  test("an experiment whose runs all failed has one finding, and no made-up numbers", () => {
    const a = analyzeExperiment(experimentOf({ id: "e1", runs: ["fail", "fail"] }));
    expect(a.findings).toEqual(["실행 2번이 모두 실패했다"]);
    expect(a.score).toBeUndefined();
    expect(a.passRate).toBe(0);
    expect(analyzeExperiment(experimentOf({ id: "e2", runs: ["cancel"] })).findings).toEqual([]);
  });
});

describe("a fork against its parent [REQ-040]", () => {
  test("the change is listed and the score difference is judged against the spread", () => {
    const parentInput = experimentOf({
      id: "p",
      runs: [SCRIPTS.wrong, SCRIPTS.wrong, SCRIPTS.wrong],
      tools: ["list_alarms", "get_entity"],
    });
    const child = forkExperiment(
      parentInput.experiment,
      { agentId: "deep" },
      { id: "c", owner: "jimin", createdAt: "2026-10-30T00:00:00.000Z" },
      parentInput.experiment.snapshot,
    );
    const childInput = experimentOf({
      id: "c",
      runs: [SCRIPTS.good, SCRIPTS.good, SCRIPTS.good],
      agentId: "deep",
      tools: child.recipe.tools,
      parentId: "p",
    });
    const parent = analyzeExperiment(parentInput);
    const a = analyzeExperiment(childInput, parent);
    expect(a.parent).toMatchObject({
      experimentId: "p",
      changes: [{ field: "agentId", before: "triage", after: "deep" }],
      passRateDelta: 1,
    });
    expect(a.parent?.scoreDelta).toBeGreaterThan(30);
    expect(a.parent?.clear).toBe(true);
    const finding = a.findings.at(-1) as string;
    expect(finding).toContain("원본 '실험 p' 대비 평균 +");
    expect(finding).toContain("분명한 차이다");
    expect(finding).toContain("에이전트 triage → deep");
  });

  test("with too few runs a difference is not called clear, and with no scores only the change is told", () => {
    const parent = analyzeExperiment(experimentOf({ id: "p", runs: [SCRIPTS.wrong] }));
    const child = analyzeExperiment(
      experimentOf({ id: "c", runs: [SCRIPTS.good], agentId: "deep" }),
      parent,
    );
    expect(child.parent?.clear).toBe(false);
    expect(child.findings.at(-1)).toContain("아직 분명한 차이는 아니다");
    const failedParent = analyzeExperiment(experimentOf({ id: "p", runs: ["fail"] }));
    const c2 = analyzeExperiment(
      experimentOf({ id: "c", runs: [SCRIPTS.good], agentId: "deep" }),
      failedParent,
    );
    expect(c2.parent?.scoreDelta).toBeUndefined();
    expect(c2.findings.at(-1)).toBe("원본 '실험 p'에서 바꾼 것: 에이전트 triage → deep");
  });
});

describe("benchmark leaderboards [REQ-039]", () => {
  const snapshot = snapshotFor();
  const analysed = (spec: Parameters<typeof experimentOf>[0], snap = snapshot) =>
    analyzeExperiment(experimentOf(spec, snap));

  test("configurations are pooled across people and ranked; small samples wait unranked", () => {
    const boards = buildLeaderboards([
      analysed({ id: "a1", owner: "yeonsu", runs: [SCRIPTS.good, SCRIPTS.good] }),
      analysed({
        id: "a2",
        owner: "jimin",
        createdAt: "2026-10-30T00:00:00.000Z",
        runs: [SCRIPTS.good],
      }),
      analysed({
        id: "b1",
        agentId: "deep",
        runs: [SCRIPTS.partial, SCRIPTS.wrong, SCRIPTS.partial],
      }),
      analysed({ id: "c1", harnessId: "h-react", runs: [SCRIPTS.good] }),
    ]);
    expect(boards).toHaveLength(1);
    const board = boards[0] as (typeof boards)[number];
    expect(board).toMatchObject({ runs: 7, title: "샘플 세계 · cooling-failure" });
    expect(board.rows.map((r) => [r.harnessId, r.agentId, r.rank])).toEqual([
      ["h-plain", "triage", 1],
      ["h-plain", "deep", 2],
      ["h-react", "triage", undefined],
    ]);
    const top = board.rows[0] as (typeof board.rows)[number];
    expect(top).toMatchObject({ runs: 3, passRate: 1, owners: ["jimin", "yeonsu"], latest: "a2" });
    expect(top.experimentIds).toEqual(["a1", "a2"]);
    expect(MIN_RUNS_TO_RANK).toBe(3);
  });

  test("only like is ranked with like: another time policy is another board", () => {
    const boards = buildLeaderboards(
      [
        analysed({ id: "x", runs: [SCRIPTS.good] }),
        analysed({ id: "y", runs: [SCRIPTS.good], time: { kind: "lockstep", secondsPerCall: 60 } }),
        analysed({ id: "z", runs: [SCRIPTS.good], time: { kind: "lockstep", secondsPerCall: 60 } }),
      ],
      1,
    );
    expect(boards.map((b) => b.runs)).toEqual([2, 1]);
    expect(boards[0]?.time).toEqual({ kind: "lockstep", secondsPerCall: 60 });
    // Same configuration and same results share a rank.
    const tied = buildLeaderboards(
      [
        analysed({ id: "p", runs: [SCRIPTS.good] }),
        analysed({ id: "q", agentId: "deep", runs: [SCRIPTS.good] }),
      ],
      1,
    );
    expect(tied[0]?.rows.map((r) => r.rank)).toEqual([1, 1]);
  });

  test("toolsets are compared as sets, not in the order they were picked", () => {
    const boards = buildLeaderboards(
      [
        analysed({ id: "p", runs: [SCRIPTS.good], tools: ["list_alarms", "get_entity"] }),
        analysed({ id: "q", runs: [SCRIPTS.good], tools: ["get_entity", "list_alarms"] }),
      ],
      1,
    );
    expect(boards[0]?.rows).toHaveLength(1);
    expect(boards[0]?.rows[0]?.runs).toBe(2);
  });
});

describe("small statistics [REQ-037]", () => {
  test("summaries use Student's t for few runs", () => {
    expect(summarize([])).toBeUndefined();
    expect(summarize([70])).toEqual({
      n: 1,
      mean: 70,
      median: 70,
      stdev: 0,
      min: 70,
      max: 70,
      ci95: 0,
    });
    expect(summarize([60, 80, 70, 90])).toEqual({
      n: 4,
      mean: 75,
      median: 75,
      stdev: 12.91,
      min: 60,
      max: 90,
      ci95: 20.54,
    });
    expect(tCritical(1)).toBe(12.706);
    expect(tCritical(30)).toBe(2.042);
    expect(tCritical(0)).toBe(1.96);
    expect(tCritical(100)).toBe(1.96);
  });

  test("a difference is clear only beyond both intervals, and never from single runs", () => {
    const low = summarize([40, 42, 44]) as NonNullable<ReturnType<typeof summarize>>;
    const high = summarize([80, 82, 84]) as NonNullable<ReturnType<typeof summarize>>;
    const wide = summarize([40, 90, 60]) as NonNullable<ReturnType<typeof summarize>>;
    expect(clearlyDifferent(low, high)).toBe(true);
    expect(clearlyDifferent(high, low)).toBe(true);
    expect(clearlyDifferent(low, wide)).toBe(false);
    expect(clearlyDifferent(summarize([10]) as never, summarize([90]) as never)).toBe(false);
    expect(ratio(1, 3)).toBe(0.3333);
    expect(ratio(1, 0)).toBe(0);
  });
});
