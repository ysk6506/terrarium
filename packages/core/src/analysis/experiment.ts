/**
 * An experiment across its runs (REQ-037), and against its parent when it is a fork (REQ-040).
 * Numbers come with their spread, so a lucky run does not read as a better agent.
 */

import {
  type Experiment,
  type ExperimentStatus,
  experimentStatus,
  type Progress,
  physicsOf,
  progressOf,
  type RecipeChange,
  type RunRecord,
  recipeDiff,
  repeatsOf,
} from "@terrarium/core/experiments";
import { formatDuration } from "@terrarium/core/kernel";
import { END_REASON_LABELS, type EndReason } from "@terrarium/core/oracle";
import { analyzeRun, type RunAnalysis } from "./run";
import { groupBySeed, meanOf, seedRate, seedSummary, splitSeeds, withinSeedSpread } from "./seeds";
import { clearlyDifferent, type Summary } from "./stats";
import { NO_TELEMETRY, type Telemetry } from "./telemetry";

export interface CriterionRate {
  readonly id: string;
  readonly label: string;
  readonly kind: string;
  /** Mean over seeds of each seed's share of completed runs that met it (for penalties: that avoided it). */
  readonly rate: number;
  readonly meanPoints: number;
  readonly max: number;
}

export interface ExperimentAnalysis {
  readonly experiment: Experiment;
  readonly status: ExperimentStatus;
  readonly progress: Progress;
  readonly runs: readonly RunAnalysis[];
  /**
   * The statistics below take the seed as their unit (ADR-0158): each is the mean over seeds of that seed's own
   * mean or share, and an interval is worked out over those seed values. `n` of a summary is the number of seeds.
   */
  readonly score?: Summary;
  /** Mean over seeds of each seed's share of passed runs. */
  readonly passRate: number;
  /** Mean over seeds of each seed's share of runs with a fully correct diagnosis. */
  readonly diagnosisRate: number;
  /** Seeds with a completed run: what the statistics are over. */
  readonly seeds: number;
  /** How many times each seed is run, from the recipe. */
  readonly repeats: number;
  /** Where the score moves between runs of one seed (pooled standard deviation); absent until a seed has two runs. */
  readonly withinSeed?: { readonly spread: number; readonly seeds: number };
  /** Seeds whose runs passed and failed both: the same situation, two outcomes. */
  readonly splitSeeds: number;
  readonly calls?: Summary;
  readonly timeToDiagnosis?: Summary;
  readonly tokens?: Summary;
  readonly costUsd?: Summary;
  readonly criteria: readonly CriterionRate[];
  readonly endReasons: Readonly<Partial<Record<EndReason, number>>>;
  readonly findings: readonly string[];
  readonly parent?: ParentComparison;
}

export interface ParentComparison {
  readonly experimentId: string;
  readonly name: string;
  readonly changes: readonly RecipeChange[];
  readonly scoreDelta?: number;
  readonly passRateDelta: number;
  /** Set when the original ran on other physics (its fingerprint): scores are then not set side by side (REQ-113). */
  readonly otherPhysics?: string;
  /** Whether the scores differ beyond both 95% intervals. */
  readonly clear: boolean;
}

export interface ExperimentInput {
  readonly experiment: Experiment;
  readonly runs: readonly RunRecord[];
  readonly telemetry?: ReadonlyMap<string, Telemetry>;
}

/** Input and output tokens together; undefined when the run reports neither. */
export const tokensOf = (r: Pick<RunAnalysis, "efficiency">): number | undefined =>
  r.efficiency.inputTokens === undefined && r.efficiency.outputTokens === undefined
    ? undefined
    : (r.efficiency.inputTokens ?? 0) + (r.efficiency.outputTokens ?? 0);

type ScoreItem = NonNullable<RunRecord["result"]>["score"]["items"][number];

function criteria(runs: readonly RunRecord[]): CriterionRate[] {
  const groups = groupBySeed(runs);
  const items = runs.flatMap((r) => r.result?.score.items ?? []);
  const ids = [...new Set(items.map((i) => i.id))];
  return ids.map((id) => {
    const mine = items.filter((i) => i.id === id);
    const first = mine[0] as ScoreItem;
    const of = (r: RunRecord) => r.result?.score.items.find((i) => i.id === id);
    const perSeed = groups.map((g) => ({
      seed: g.seed,
      items: g.items.map(of).filter((i): i is ScoreItem => i !== undefined),
    }));
    const some = perSeed.filter((g) => g.items.length > 0);
    return {
      id,
      label: first.label,
      kind: first.kind,
      rate: seedRate(some, (i) => i.verdict === "pass" || i.verdict === "clean"),
      meanPoints:
        Math.round(meanOf(some.map((g) => meanOf(g.items.map((i) => i.points)))) * 100) / 100,
      max: first.max,
    };
  });
}

/** How runs that ended for this reason say it: an operation in its own words, the rest as ever. */
export function endLabelOf(a: Pick<ExperimentAnalysis, "runs">, reason: EndReason): string {
  return (
    a.runs.find((r) => r.endReason === reason && r.endLabel)?.endLabel ?? END_REASON_LABELS[reason]
  );
}

function endReasons(runs: readonly RunRecord[]): Partial<Record<EndReason, number>> {
  const out: Partial<Record<EndReason, number>> = {};
  for (const r of runs) if (r.result) out[r.result.endReason] = (out[r.result.endReason] ?? 0) + 1;
  return out;
}

export function analyzeExperiment(
  input: ExperimentInput,
  parent?: ExperimentAnalysis,
): ExperimentAnalysis {
  const runs = input.runs.map((r) =>
    analyzeRun(r, (r.harness?.traceId && input.telemetry?.get(r.harness.traceId)) || NO_TELEMETRY),
  );
  const groups = groupBySeed(runs.filter((r) => r.status === "completed"));
  const withinSeed = withinSeedSpread(groups, (r) => r.score);
  const base = {
    experiment: input.experiment,
    status: experimentStatus(input.runs),
    progress: progressOf(input.runs),
    runs,
    passRate: seedRate(groups, (r) => r.passed),
    diagnosisRate: seedRate(groups, (r) => r.diagnosis.root && r.diagnosis.type),
    seeds: groups.length,
    repeats: repeatsOf(input.experiment.recipe),
    splitSeeds: splitSeeds(groups, (r) => r.passed),
    ...(withinSeed ? { withinSeed } : {}),
    criteria: criteria(input.runs.filter((r) => r.status === "completed")),
    endReasons: endReasons(input.runs),
    ...optional({
      score: seedSummary(groups, (r) => r.score),
      calls: seedSummary(groups, (r) => r.efficiency.investigationCalls),
      timeToDiagnosis: seedSummary(groups, (r) => r.diagnosis.afterSeconds),
      tokens: seedSummary(groups, tokensOf),
      costUsd: seedSummary(groups, (r) => r.efficiency.costUsd),
    }),
  };
  const comparison = parent ? compareWithParent(base, parent) : undefined;
  const withParent = { ...base, ...(comparison ? { parent: comparison } : {}) };
  return { ...withParent, findings: experimentFindings(withParent) };
}

function optional<T extends Record<string, unknown>>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

function compareWithParent(
  a: Omit<ExperimentAnalysis, "findings">,
  parent: ExperimentAnalysis,
): ParentComparison {
  // runs on other physics are not set side by side (REQ-113): no score difference, only the change
  const samePhysics = physicsOf(a.experiment) === physicsOf(parent.experiment);
  return {
    experimentId: parent.experiment.id,
    name: parent.experiment.name,
    changes: recipeDiff(parent.experiment.recipe, a.experiment.recipe),
    ...(!samePhysics ? { otherPhysics: physicsOf(parent.experiment) } : {}),
    ...(samePhysics && a.score && parent.score
      ? { scoreDelta: Math.round((a.score.mean - parent.score.mean) * 10) / 10 }
      : {}),
    passRateDelta: samePhysics ? Math.round((a.passRate - parent.passRate) * 1000) / 1000 : 0,
    clear:
      samePhysics &&
      a.score !== undefined &&
      parent.score !== undefined &&
      clearlyDifferent(a.score, parent.score),
  };
}

const pct = (r: number) => `${Math.round(r * 100)}%`;

function experimentFindings(a: Omit<ExperimentAnalysis, "findings">): string[] {
  const done = a.runs.filter((r) => r.status === "completed");
  if (done.length === 0)
    return a.progress.failed > 0 ? [`실행 ${a.progress.failed}번이 모두 실패했어요`] : [];
  const passed = done.filter((r) => r.passed).length;
  const out =
    a.repeats > 1
      ? [`${done.length}번 중 ${passed}번 합격 (상황별 합격률의 평균 ${pct(a.passRate)})`]
      : [`${done.length}번 중 ${passed}번 합격 (${pct(a.passRate)})`];
  out.push(...spreadFindings(a));
  for (const c of a.criteria.filter((x) => x.rate < 0.5))
    out.push(`'${c.label}' 항목을 ${pct(1 - c.rate)}의 실행에서 놓쳤어요`);
  const reasons = Object.entries(a.endReasons).filter(([r]) => r !== "diagnosed");
  for (const [reason, n] of reasons)
    out.push(`${n}번은 ${endLabelOf(a, reason as EndReason)}로 끝났어요`);
  if (a.timeToDiagnosis)
    out.push(`진단까지 평균 ${formatDuration(a.timeToDiagnosis.mean)} (시뮬레이션 시간)`);
  if (a.parent) out.push(...parentFindings(a.parent, a.repeats > 1));
  return out;
}

/** Below this many points both spreads are small enough that nothing needs saying about where the differences come from. */
const SPREAD_WORTH_SAYING = 5;

/**
 * Where the score differences come from. Repeated: compare the shaking inside a situation (pooled spread within
 * seeds) with the spread between situations (the spread of the seed means) and say which is the larger. Once: only
 * a wide spread between runs is worth a line, as it always was. (The two figures have lines of their own on the screen.)
 */
function spreadFindings(a: Omit<ExperimentAnalysis, "findings">): string[] {
  if (a.repeats > 1 && a.withinSeed && a.score && a.score.n > 1) {
    const within = a.withinSeed.spread;
    const between = a.score.stdev;
    if (Math.max(within, between) < SPREAD_WORTH_SAYING) return [];
    return within >= between
      ? [
          "점수 차이는 주로 에이전트가 같은 상황에서도 흔들려서 생겨요 — 같은 상황을 더 여러 번 돌려 보세요",
        ]
      : ["점수 차이는 주로 상황이 달라서 생겨요 — 상황을 늘려 보세요"];
  }
  // no situation has two runs: its luck cannot be told from the agent's wobble, so the advice says which count to raise
  if (a.score && a.score.n > 1 && a.score.stdev >= 15)
    return [
      `실행마다 점수가 크게 달라요 (표준편차 ${a.score.stdev}점) — ${
        a.withinSeed
          ? "실행을 늘려 보는 것이 좋아요"
          : "상황이 달라서인지 에이전트가 흔들려서인지는 같은 상황을 여러 번 돌려야 알 수 있어요"
      }`,
    ];
  return [];
}

function parentFindings(p: ParentComparison, repeated: boolean): string[] {
  if (p.otherPhysics !== undefined)
    return [`원본 '${p.name}'과 물리가 달라요(${p.otherPhysics}) — 점수를 견주지 않아요`];
  const what = p.changes.map((c) => `${c.label} ${c.before} → ${c.after}`).join("; ");
  if (p.scoreDelta === undefined) return [`원본 '${p.name}'에서 바꾼 것: ${what}`];
  const signed = (n: number) => `${n > 0 ? "+" : ""}${n}`;
  const unclear = repeated
    ? "상황 수에 비해 아직 분명한 차이는 아니에요"
    : "실행 수에 비해 아직 분명한 차이는 아니에요";
  const verdict = p.clear ? "분명한 차이예요" : unclear;
  return [
    `원본 '${p.name}' 대비 평균 ${signed(p.scoreDelta)}점, 합격률 ${signed(Math.round(p.passRateDelta * 100))}%p. ${verdict} (바꾼 것: ${what})`,
  ];
}
