import { describe, expect, test } from "vitest";
import { analyzeExperiment, buildLeaderboards, type ExperimentAnalysis } from ".";
import { experimentOf, SCRIPTS, snapshotFor } from "./test-support/runs";

/**
 * The golden numbers of ADR-0158 item 8. They were taken from the analysis as it was before the seed became the unit
 * of statistics, on experiments that run each seed once and share no seed: nothing may move there. Where a seed is
 * shared by experiments (the leaderboard), the numbers do move; that case is written out below, before and after.
 */

const GOLDEN = {
  a: {
    score: {
      n: 5,
      mean: 56,
      median: 61.8,
      stdev: 36.49,
      min: 18.2,
      max: 90.9,
      ci95: 45.31,
    },
    passRate: 0.4,
    diagnosisRate: 0.4,
    calls: {
      n: 5,
      mean: 1.8,
      median: 2,
      stdev: 0.84,
      min: 1,
      max: 3,
      ci95: 1.04,
    },
    timeToDiagnosis: {
      n: 4,
      mean: 60,
      median: 60,
      stdev: 24.49,
      min: 30,
      max: 90,
      ci95: 38.97,
    },
    tokens: {
      n: 5,
      mean: 1200,
      median: 1200,
      stdev: 0,
      min: 1200,
      max: 1200,
      ci95: 0,
    },
    costUsd: {
      n: 5,
      mean: 0.02,
      median: 0.02,
      stdev: 0,
      min: 0.02,
      max: 0.02,
      ci95: 0,
    },
    criteria: [
      ["diagnosis", 0.4, 31.2],
      ["servers-alive", 1, 20],
      ["spare-setpoint", 0, 0],
      ["time", 0.4, 5.2],
      ["budget", 0.4, 5.2],
    ],
    endReasons: {
      diagnosed: 4,
      agent_finished: 1,
    },
    findings: [
      "5번 중 2번 합격 (40%)",
      "실행마다 점수가 크게 달라요 (표준편차 36.49점) — 실행을 늘려 보는 것이 좋아요",
      "'진단' 항목을 60%의 실행에서 놓쳤어요",
      "'crah-2 설정 온도 낮추기' 항목을 100%의 실행에서 놓쳤어요",
      "'진단 시간' 항목을 60%의 실행에서 놓쳤어요",
      "'툴 사용 효율' 항목을 60%의 실행에서 놓쳤어요",
      "1번은 진단 없이 종료로 끝났어요",
      "진단까지 평균 1분 (시뮬레이션 시간)",
    ],
  },
  b: {
    score: {
      n: 5,
      mean: 85.08,
      median: 90.9,
      stdev: 13.01,
      min: 61.8,
      max: 90.9,
      ci95: 16.16,
    },
    passRate: 0.8,
    diagnosisRate: 0.8,
    calls: {
      n: 5,
      mean: 1.8,
      median: 2,
      stdev: 0.45,
      min: 1,
      max: 2,
      ci95: 0.56,
    },
    timeToDiagnosis: {
      n: 5,
      mean: 54,
      median: 60,
      stdev: 13.42,
      min: 30,
      max: 60,
      ci95: 16.66,
    },
    criteria: [
      ["diagnosis", 0.8, 55.2],
      ["servers-alive", 1, 20],
      ["spare-setpoint", 0, 0],
      ["time", 0.8, 9.2],
      ["budget", 0.8, 9.2],
    ],
    endReasons: {
      diagnosed: 5,
    },
    findings: [
      "5번 중 4번 합격 (80%)",
      "'crah-2 설정 온도 낮추기' 항목을 100%의 실행에서 놓쳤어요",
      "진단까지 평균 54초 (시뮬레이션 시간)",
      "원본 '실험 a' 대비 평균 +29.1점, 합격률 +40%p. 실행 수에 비해 아직 분명한 차이는 아니에요 (바꾼 것: 에이전트 triage → deep)",
    ],
    parent: {
      scoreDelta: 29.1,
      passRateDelta: 0.4,
      clear: false,
    },
  },
  c: {
    score: {
      n: 3,
      mean: 81.2,
      median: 90.9,
      stdev: 16.8,
      min: 61.8,
      max: 90.9,
      ci95: 41.74,
    },
    passRate: 0.6667,
    diagnosisRate: 0.6667,
    calls: {
      n: 3,
      mean: 1.67,
      median: 2,
      stdev: 0.58,
      min: 1,
      max: 2,
      ci95: 1.43,
    },
    timeToDiagnosis: {
      n: 3,
      mean: 50,
      median: 60,
      stdev: 17.32,
      min: 30,
      max: 60,
      ci95: 43.03,
    },
    criteria: [
      ["diagnosis", 0.6667, 52],
      ["servers-alive", 1, 20],
      ["spare-setpoint", 0, 0],
      ["time", 0.6667, 8.67],
      ["budget", 0.6667, 8.67],
    ],
    endReasons: {
      diagnosed: 3,
    },
    findings: [
      "3번 중 2번 합격 (67%)",
      "실행마다 점수가 크게 달라요 (표준편차 16.8점) — 실행을 늘려 보는 것이 좋아요",
      "'crah-2 설정 온도 낮추기' 항목을 100%의 실행에서 놓쳤어요",
      "진단까지 평균 50초 (시뮬레이션 시간)",
    ],
  },
  distinct: [
    {
      agent: "deep",
      rank: 1,
      runs: 3,
      passRate: 0.6667,
      score: {
        n: 3,
        mean: 81.2,
        median: 90.9,
        stdev: 16.8,
        min: 61.8,
        max: 90.9,
        ci95: 41.74,
      },
      calls: {
        n: 3,
        mean: 1.67,
        median: 2,
        stdev: 0.58,
        min: 1,
        max: 2,
        ci95: 1.43,
      },
    },
    {
      agent: "triage",
      rank: 2,
      runs: 6,
      passRate: 0.3333,
      score: {
        n: 6,
        mean: 56.97,
        median: 61.8,
        stdev: 32.73,
        min: 18.2,
        max: 90.9,
        ci95: 34.35,
      },
      calls: {
        n: 6,
        mean: 2,
        median: 2,
        stdev: 0.89,
        min: 1,
        max: 3,
        ci95: 0.94,
      },
    },
  ],
  overlap: [
    {
      agent: "deep",
      rank: 1,
      runs: 3,
      passRate: 0.6667,
      score: {
        n: 3,
        mean: 81.2,
        median: 90.9,
        stdev: 16.8,
        min: 61.8,
        max: 90.9,
        ci95: 41.74,
      },
      calls: {
        n: 3,
        mean: 1.67,
        median: 2,
        stdev: 0.58,
        min: 1,
        max: 2,
        ci95: 1.43,
      },
    },
    {
      agent: "triage",
      rank: 2,
      runs: 6,
      passRate: 0.3333,
      score: {
        n: 6,
        mean: 56.97,
        median: 61.8,
        stdev: 32.73,
        min: 18.2,
        max: 90.9,
        ci95: 34.35,
      },
      calls: {
        n: 6,
        mean: 2,
        median: 2,
        stdev: 0.89,
        min: 1,
        max: 3,
        ci95: 0.94,
      },
    },
  ],
} as any;

/** What the six runs of the repeated experiment above make by hand: seed means 90.9, 76.35 and 18.2. */
const EXPECT_REPEATED = {
  score: { n: 3, mean: 61.82, median: 76.35, stdev: 38.47, min: 18.2, max: 90.9, ci95: 95.57 },
  spread: 11.88,
};

type Spec = Parameters<typeof experimentOf>[0];

/** An experiment whose runs have the seeds `first`, `first + 1` … instead of 1, 2 …: another set of situations. */
function seededFrom(spec: Spec, first: number) {
  const { experiment, runs } = experimentOf(spec);
  const by = first - 1;
  return {
    experiment: {
      ...experiment,
      recipe: { ...experiment.recipe, seeds: experiment.recipe.seeds.map((s) => s + by) },
    },
    runs: runs.map((r) => ({ ...r, seed: r.seed + by })),
  };
}

/** The same experiment run `repeats` times per seed: the scripts are listed seed by seed, `repeats` of them for each. */
function repeated(spec: Spec, repeats: number) {
  const { experiment, runs } = experimentOf(spec);
  const seeds = [...new Set(runs.map((_, i) => Math.floor(i / repeats) + 1))];
  return {
    experiment: { ...experiment, recipe: { ...experiment.recipe, seeds, repeats } },
    runs: runs.map((r, i) => ({
      ...r,
      seed: Math.floor(i / repeats) + 1,
      repeat: (i % repeats) + 1,
    })),
  };
}

/** What the old analysis said, as far as numbers go. */
const numbersOf = (a: ExperimentAnalysis) => ({
  score: a.score,
  passRate: a.passRate,
  diagnosisRate: a.diagnosisRate,
  calls: a.calls,
  timeToDiagnosis: a.timeToDiagnosis,
  tokens: a.tokens,
  costUsd: a.costUsd,
  criteria: a.criteria.map((c) => [c.id, c.rate, c.meanPoints]),
  endReasons: a.endReasons,
  findings: a.findings,
  ...(a.parent
    ? {
        parent: {
          scoreDelta: a.parent.scoreDelta,
          passRateDelta: a.parent.passRateDelta,
          clear: a.parent.clear,
        },
      }
    : {}),
});

const rowsOf = (boards: ReturnType<typeof buildLeaderboards>) =>
  boards.flatMap((b) =>
    b.rows.map((r) => ({
      agent: r.agentId,
      rank: r.rank,
      runs: r.runs,
      passRate: r.passRate,
      score: r.score,
      calls: r.calls,
    })),
  );

const harness = { inputTokens: 1000, outputTokens: 200, costUsd: 0.02 };
const { good, partial, wrong, silent } = SCRIPTS;
const snap = snapshotFor();
const analysed = (made: ReturnType<typeof experimentOf>, parent?: ExperimentAnalysis) =>
  analyzeExperiment(made, parent);

describe("one run per seed, no shared seed: the numbers are the ones from before [REQ-118]", () => {
  const a = analysed(
    experimentOf({ id: "a", harness, runs: [good, partial, wrong, good, silent] }),
  );

  test("a mixed experiment: score interval, rates, efficiency, criteria and findings", () => {
    expect(numbersOf(a)).toEqual(GOLDEN.a);
    expect([a.seeds, a.repeats, a.splitSeeds, a.withinSeed]).toEqual([5, 1, 0, undefined]);
  });

  test("a fork is compared with its parent on the same numbers, and the verdict stands", () => {
    const b = analysed(
      experimentOf({
        id: "b",
        parentId: "a",
        agentId: "deep",
        runs: [good, good, good, partial, good],
      }),
      a,
    );
    expect(numbersOf(b)).toEqual(GOLDEN.b);
  });

  test("runs that failed or were stopped are left out as they were", () => {
    const c = analysed(experimentOf({ id: "c", runs: [good, "fail", partial, "cancel", good] }));
    expect(numbersOf(c)).toEqual(GOLDEN.c);
  });

  test("a leaderboard whose experiments share no seed pools runs as it did", () => {
    const board = buildLeaderboards([
      analysed(experimentOf({ id: "y", owner: "yeonsu", runs: [good, partial, wrong] }, snap)),
      analysed(seededFrom({ id: "j", owner: "jimin", runs: [good, wrong, partial] }, 4)),
      analysed(experimentOf({ id: "d", agentId: "deep", runs: [good, good, partial] }, snap)),
    ]);
    expect(rowsOf(board)).toEqual(GOLDEN.distinct);
  });
});

describe("a seed that two experiments share counts once on the leaderboard [REQ-118]", () => {
  const share = (jiminFirstSeed: number) =>
    buildLeaderboards([
      analysed(experimentOf({ id: "y", owner: "yeonsu", runs: [good, partial, wrong] }, snap)),
      analysed(
        seededFrom({ id: "j", owner: "jimin", runs: [good, wrong, partial] }, jiminFirstSeed),
      ),
      analysed(experimentOf({ id: "d", agentId: "deep", runs: [good, good, partial] }, snap)),
    ]);

  test("before: six runs read as six samples. after: three seeds, a wider interval", () => {
    const triage = (rows: ReturnType<typeof rowsOf>) => rows.find((r) => r.agent === "triage");
    // as the leaderboard said it before the seed became the unit (taken from the code of that time)
    expect(triage(GOLDEN.overlap)).toMatchObject({
      runs: 6,
      score: { n: 6, mean: 56.97, stdev: 32.73, ci95: 34.35 },
    });
    expect(triage(rowsOf(share(1)))).toMatchObject({
      rank: 2,
      runs: 6,
      passRate: 0.3333,
      score: { n: 3, mean: 56.97, median: 40, stdev: 29.39, min: 40, max: 90.9, ci95: 73.01 },
      calls: { n: 3, mean: 2, stdev: 0, ci95: 0 },
    });
    // the same six runs on six different seeds are still six samples
    expect(triage(rowsOf(share(4)))).toMatchObject({ score: { n: 6, ci95: 34.35 } });
  });

  test("a configuration with runs on fewer than three different seeds waits unranked, however many runs it has", () => {
    const board = buildLeaderboards([
      analysed(experimentOf({ id: "y", owner: "yeonsu", runs: [good, good] }, snap)),
      analysed(experimentOf({ id: "j", owner: "jimin", runs: [good, good] }, snap)),
      analysed(experimentOf({ id: "k", owner: "kim", runs: [good, good] }, snap)),
      analysed(experimentOf({ id: "d", agentId: "deep", runs: [good, good, good] }, snap)),
    ]);
    const rows = rowsOf(board);
    expect(rows.map((r) => [r.agent, r.runs, r.rank])).toEqual([
      ["deep", 3, 1],
      ["triage", 6, undefined],
    ]);
    expect(board[0]?.rows[1]?.seeds).toBe(2);
  });
});

describe("repeats of a seed: the seed is the unit [REQ-118]", () => {
  // seed 1 twice good; seed 2 good then half right; seed 3 wrong then silent
  const made = repeated({ id: "r", runs: [good, good, good, partial, wrong, silent] }, 2);
  const r = analysed(made);

  test("the mean is the mean of the seed means, and the interval is over three seeds, not six runs", () => {
    expect(r.seeds).toBe(3);
    expect(r.repeats).toBe(2);
    expect(r.score).toEqual(EXPECT_REPEATED.score);
    expect(r.passRate).toBe(0.5);
    expect(r.diagnosisRate).toBe(0.5);
  });

  test("the shaking inside a seed is its own number, and so are the seeds that came out both ways", () => {
    expect(r.withinSeed).toEqual({ spread: EXPECT_REPEATED.spread, seeds: 3 });
    expect(r.splitSeeds).toBe(1);
    expect(r.findings).toContain("시드 3개 중 1개에서 같은 조건인데 합격과 불합격이 갈렸어요");
    expect(r.findings[0]).toBe("6번 중 3번 합격 (시드별 합격률의 평균 50%)");
  });

  test("a seed run once has no spread to tell; with every seed run once nothing is said about splits", () => {
    const once = analysed(experimentOf({ id: "o", runs: [good, partial, wrong] }));
    expect(once.withinSeed).toBeUndefined();
    expect(once.splitSeeds).toBe(0);
  });

  test("a difference is clear only over two seeds or more: four runs of one seed are one situation", () => {
    const against = (perSeed: number, seeds: number) => {
      const bad = Array.from({ length: perSeed * seeds }, () => wrong);
      const better = Array.from({ length: perSeed * seeds }, () => good);
      const parent = analysed(repeated({ id: "p", runs: bad }, perSeed));
      return analysed(
        repeated({ id: "c", parentId: "p", agentId: "deep", runs: better }, perSeed),
        parent,
      );
    };
    const one = against(4, 1);
    expect(one.parent).toMatchObject({ scoreDelta: 72.7, clear: false });
    expect(one.findings.at(-1)).toContain("시드 수에 비해 아직 분명한 차이는 아니에요");
    const two = against(2, 2);
    expect(two.parent).toMatchObject({ scoreDelta: 72.7, clear: true });
    expect(two.findings.at(-1)).toContain("분명한 차이예요");
  });
});
