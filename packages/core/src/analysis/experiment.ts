/**
 * An experiment across its runs (REQ-037), and against its parent when it is a fork (REQ-040).
 * Numbers come with their spread, so a lucky run does not read as a better agent.
 */

import {
  type Experiment,
  type ExperimentStatus,
  experimentStatus,
  type Progress,
  progressOf,
  type RecipeChange,
  type RunRecord,
  recipeDiff,
} from "@terrarium/core/experiments";
import { formatDuration } from "@terrarium/core/kernel";
import { END_REASON_LABELS, type EndReason } from "@terrarium/core/oracle";
import { analyzeRun, type RunAnalysis } from "./run";
import { clearlyDifferent, ratio, type Summary, summarize } from "./stats";
import { NO_TELEMETRY, type Telemetry } from "./telemetry";

export interface CriterionRate {
  readonly id: string;
  readonly label: string;
  readonly kind: string;
  /** Share of completed runs that met it (for penalties: that avoided it). */
  readonly rate: number;
  readonly meanPoints: number;
  readonly max: number;
}

export interface ExperimentAnalysis {
  readonly experiment: Experiment;
  readonly status: ExperimentStatus;
  readonly progress: Progress;
  readonly runs: readonly RunAnalysis[];
  readonly score?: Summary;
  readonly passRate: number;
  /** Share of completed runs with a fully correct diagnosis. */
  readonly diagnosisRate: number;
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
  /** Whether the scores differ beyond both 95% intervals. */
  readonly clear: boolean;
}

export interface ExperimentInput {
  readonly experiment: Experiment;
  readonly runs: readonly RunRecord[];
  readonly telemetry?: ReadonlyMap<string, Telemetry>;
}

const numbers = (xs: readonly (number | undefined | null)[]) =>
  xs.filter((x): x is number => typeof x === "number");

function criteria(runs: readonly RunRecord[]): CriterionRate[] {
  const items = runs.flatMap((r) => r.result?.score.items ?? []);
  const ids = [...new Set(items.map((i) => i.id))];
  return ids.map((id) => {
    const mine = items.filter((i) => i.id === id);
    const first = mine[0] as (typeof mine)[number];
    const met = mine.filter((i) => i.verdict === "pass" || i.verdict === "clean").length;
    return {
      id,
      label: first.label,
      kind: first.kind,
      rate: ratio(met, mine.length),
      meanPoints: Math.round((mine.reduce((s, i) => s + i.points, 0) / mine.length) * 100) / 100,
      max: first.max,
    };
  });
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
  const done = runs.filter((r) => r.status === "completed");
  const tokens = done.map((r) =>
    r.efficiency.inputTokens === undefined && r.efficiency.outputTokens === undefined
      ? undefined
      : (r.efficiency.inputTokens ?? 0) + (r.efficiency.outputTokens ?? 0),
  );
  const base = {
    experiment: input.experiment,
    status: experimentStatus(input.runs),
    progress: progressOf(input.runs),
    runs,
    passRate: ratio(done.filter((r) => r.passed).length, done.length),
    diagnosisRate: ratio(
      done.filter((r) => r.diagnosis.root && r.diagnosis.type).length,
      done.length,
    ),
    criteria: criteria(input.runs.filter((r) => r.status === "completed")),
    endReasons: endReasons(input.runs),
    ...optional({
      score: summarize(numbers(done.map((r) => r.score))),
      calls: summarize(done.map((r) => r.efficiency.investigationCalls)),
      timeToDiagnosis: summarize(numbers(done.map((r) => r.diagnosis.afterSeconds))),
      tokens: summarize(numbers(tokens)),
      costUsd: summarize(numbers(done.map((r) => r.efficiency.costUsd))),
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
  return {
    experimentId: parent.experiment.id,
    name: parent.experiment.name,
    changes: recipeDiff(parent.experiment.recipe, a.experiment.recipe),
    ...(a.score && parent.score
      ? { scoreDelta: Math.round((a.score.mean - parent.score.mean) * 10) / 10 }
      : {}),
    passRateDelta: Math.round((a.passRate - parent.passRate) * 1000) / 1000,
    clear:
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
  const out = [
    `${done.length}번 중 ${done.filter((r) => r.passed).length}번 합격 (${pct(a.passRate)})`,
  ];
  if (a.score && a.score.n > 1 && a.score.stdev >= 15)
    out.push(
      `실행마다 점수가 크게 달라요 (표준편차 ${a.score.stdev}점) — 실행을 늘려 보는 것이 좋아요`,
    );
  for (const c of a.criteria.filter((x) => x.rate < 0.5))
    out.push(`'${c.label}' 항목을 ${pct(1 - c.rate)}의 실행에서 놓쳤어요`);
  const reasons = Object.entries(a.endReasons).filter(([r]) => r !== "diagnosed");
  for (const [reason, n] of reasons)
    out.push(`${n}번은 ${END_REASON_LABELS[reason as EndReason]}로 끝났어요`);
  if (a.timeToDiagnosis)
    out.push(`진단까지 평균 ${formatDuration(a.timeToDiagnosis.mean)} (시뮬레이션 시간)`);
  if (a.parent) out.push(...parentFindings(a.parent));
  return out;
}

function parentFindings(p: ParentComparison): string[] {
  const what = p.changes.map((c) => `${c.label} ${c.before} → ${c.after}`).join("; ");
  if (p.scoreDelta === undefined) return [`원본 '${p.name}'에서 바꾼 것: ${what}`];
  const signed = (n: number) => `${n > 0 ? "+" : ""}${n}`;
  const verdict = p.clear ? "분명한 차이예요" : "실행 수에 비해 아직 분명한 차이는 아니에요";
  return [
    `원본 '${p.name}' 대비 평균 ${signed(p.scoreDelta)}점, 합격률 ${signed(Math.round(p.passRateDelta * 100))}%p. ${verdict} (바꾼 것: ${what})`,
  ];
}
