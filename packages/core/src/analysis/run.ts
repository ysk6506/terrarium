/**
 * One run, analysed (REQ-037): the oracle's score, what the agent did with the tools, how much it
 * cost, and findings in plain Korean that point at the evidence. Telemetry from the harness is used
 * when there is any; without it the analysis still stands on Terrarium's own records.
 */

import type { RunRecord, RunStatus } from "@terrarium/core/experiments";
import { formatDuration, withJosa } from "@terrarium/core/kernel";
import {
  type EndReason,
  endReasonLabel,
  investigationCalls,
  type OperationEnd,
} from "@terrarium/core/oracle";
import {
  ACTION_LABELS,
  type ActionKind,
  agentActions,
  callTargets,
  type ToolCallRecord,
} from "@terrarium/core/scenario";
import { NO_TELEMETRY, type Telemetry, usageOf } from "./telemetry";

export interface RunAnalysis {
  readonly runId: string;
  readonly index: number;
  readonly seed: number;
  readonly status: RunStatus;
  readonly score: number | null;
  readonly passed: boolean;
  readonly endReason?: EndReason;
  /** How it ended in an operation's own words ("운영 시간 끝(8시간)"); only for an operation run. */
  readonly endLabel?: string;
  readonly diagnosis: {
    readonly submitted: boolean;
    readonly root: boolean;
    readonly type: boolean;
    /** Simulated seconds from the task to the diagnosis. */
    readonly afterSeconds?: number;
    readonly summary?: string;
  };
  readonly efficiency: {
    readonly investigationCalls: number;
    readonly failedCalls: number;
    /** Simulated seconds the agent worked. */
    readonly simSeconds: number;
    readonly inputTokens?: number;
    readonly outputTokens?: number;
    readonly costUsd?: number;
    readonly llmCalls?: number;
    readonly llmSeconds?: number;
    readonly wallSeconds?: number;
  };
  readonly behaviour: {
    readonly toolUse: Readonly<Record<string, number>>;
    readonly actions: Readonly<Partial<Record<ActionKind, number>>>;
    /** Calls identical to an earlier one (same tool and arguments). */
    readonly repeated: number;
    /** Simulated seconds until the agent first looked at a right answer. */
    readonly firstTouchSeconds?: number;
    readonly forbidden: readonly string[];
  };
  readonly findings: readonly string[];
  readonly error?: string;
}

function countTools(calls: readonly ToolCallRecord[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of calls) out[c.tool] = (out[c.tool] ?? 0) + 1;
  return out;
}

function countActions(calls: readonly ToolCallRecord[]): Partial<Record<ActionKind, number>> {
  const out: Partial<Record<ActionKind, number>> = {};
  for (const a of agentActions(calls)) out[a.action] = (out[a.action] ?? 0) + 1;
  return out;
}

function repeatedCalls(calls: readonly ToolCallRecord[]): number {
  const seen = new Set<string>();
  let repeats = 0;
  for (const c of calls) {
    const key = `${c.tool}:${JSON.stringify(c.args)}`;
    if (seen.has(key)) repeats++;
    seen.add(key);
  }
  return repeats;
}

/** Answer entities the oracle expected. */
function answerIds(run: RunRecord): readonly string[] {
  return run.result?.score.items.find((i) => i.kind === "diagnosis")?.facts?.rootCause ?? [];
}

function firstTouch(run: RunRecord, answers: readonly string[]): number | undefined {
  const start = run.result?.task.startedAt ?? 0;
  const call = run.result?.toolCalls.find((c) =>
    callTargets(c.args).some((t) => answers.includes(t)),
  );
  return call ? call.t - start : undefined;
}

function harnessNumbers(run: RunRecord, telemetry: Telemetry) {
  const usage = usageOf(telemetry);
  const h = run.harness;
  const pick = (fromHarness: number | undefined, fromTrace: number) =>
    fromHarness ?? (telemetry.spans.length > 0 ? fromTrace : undefined);
  return {
    inputTokens: pick(h?.inputTokens, usage.inputTokens),
    outputTokens: pick(h?.outputTokens, usage.outputTokens),
    costUsd: h?.costUsd,
    llmCalls: telemetry.spans.length > 0 ? usage.llmCalls : undefined,
    llmSeconds: telemetry.spans.length > 0 ? Math.round(usage.llmSeconds * 10) / 10 : undefined,
    wallSeconds: pick(h?.wallSeconds, usage.wallSeconds),
  };
}

const defined = <T extends Record<string, unknown>>(o: T): Partial<T> =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;

type RunResultOf = NonNullable<RunRecord["result"]>;

function diagnosisOf(result: RunResultOf | undefined): RunAnalysis["diagnosis"] {
  if (!result) return { submitted: false, root: false, type: false };
  const facts = result.score.items.find((i) => i.kind === "diagnosis")?.facts;
  return {
    submitted: result.diagnosis !== undefined,
    root: facts?.root ?? false,
    type: facts?.type ?? false,
    ...(result.diagnosedAt !== undefined
      ? { afterSeconds: result.diagnosedAt - result.task.startedAt }
      : {}),
    ...(result.diagnosis ? { summary: result.diagnosis.summary } : {}),
  };
}

function efficiencyOf(run: RunRecord, telemetry: Telemetry): RunAnalysis["efficiency"] {
  const result = run.result;
  const calls = result?.toolCalls ?? [];
  const start = result?.task.startedAt ?? 0;
  const end = result?.diagnosedAt ?? result?.simTime.end ?? start;
  return {
    investigationCalls: investigationCalls(calls),
    failedCalls: calls.filter((c) => !c.ok).length,
    simSeconds: end - start,
    ...defined(harnessNumbers(run, telemetry)),
  };
}

function behaviourOf(run: RunRecord, answers: readonly string[]): RunAnalysis["behaviour"] {
  const calls = run.result?.toolCalls ?? [];
  return {
    toolUse: countTools(calls),
    actions: countActions(calls),
    repeated: repeatedCalls(calls),
    ...defined({ firstTouchSeconds: firstTouch(run, answers) }),
    forbidden: (run.result?.score.items ?? [])
      .filter((i) => i.verdict === "penalty")
      .map((i) => `${i.label} (${i.detail})`),
  };
}

/** What an operation result says it was held to, for the words of how it ended. */
export function operationEnd(
  report: { readonly config: { readonly hours: number } },
  task: { readonly maxToolCalls: number },
): OperationEnd {
  return { hours: report.config.hours, maxToolCalls: task.maxToolCalls };
}

export function analyzeRun(run: RunRecord, telemetry: Telemetry = NO_TELEMETRY): RunAnalysis {
  const result = run.result;
  const answers = answerIds(run);
  const analysis: Omit<RunAnalysis, "findings"> = {
    runId: run.id,
    index: run.index,
    seed: run.seed,
    status: run.status,
    score: result?.score.total ?? null,
    passed: result?.score.passed ?? false,
    ...(result ? { endReason: result.endReason } : {}),
    ...(result?.operation
      ? { endLabel: endReasonLabel(result.endReason, operationEnd(result.operation, result.task)) }
      : {}),
    diagnosis: diagnosisOf(result),
    efficiency: efficiencyOf(run, telemetry),
    behaviour: behaviourOf(run, answers),
    ...(run.error ? { error: run.error } : {}),
  };
  return { ...analysis, findings: runFindings(analysis, run, answers) };
}

function runFindings(
  a: Omit<RunAnalysis, "findings">,
  run: RunRecord,
  answers: readonly string[],
): string[] {
  if (run.status === "failed") return [`실행이 실패했어요: ${run.error ?? "원인 미상"}`];
  if (run.status === "cancelled") return ["실행이 멈췄어요"];
  if (!run.result) return [];
  return [
    ...diagnosisFindings(a, run.result),
    ...a.behaviour.forbidden.map((f) => `금지 행동: ${f}`),
    ...attentionFindings(a, run.result.task.timeLimitSeconds, answers),
    ...habitFindings(a),
  ];
}

function diagnosisFindings(a: Omit<RunAnalysis, "findings">, result: RunResultOf): string[] {
  if (!a.diagnosis.submitted)
    return [`진단을 제출하지 않았어요 (종료: ${a.endLabel ?? endReasonLabel(result.endReason)})`];
  if (a.diagnosis.root && a.diagnosis.type) return [];
  const item = result.score.items.find((i) => i.kind === "diagnosis");
  const how = a.diagnosis.root || a.diagnosis.type ? "일부만 맞았어요" : "틀렸어요";
  return item ? [`진단이 ${how}: ${item.detail}`] : [];
}

/** Whether, and how late, the agent looked at the right equipment. */
function attentionFindings(
  a: Omit<RunAnalysis, "findings">,
  limit: number,
  answers: readonly string[],
): string[] {
  const first = a.behaviour.firstTouchSeconds;
  if (first === undefined)
    return answers.length > 0
      ? [`정답 장비(${answers.join(", ")})를 한 번도 직접 살펴보지 않았어요`]
      : [];
  return first > limit / 2
    ? [`정답 장비(${answers.join(", ")})를 처음 살펴본 것은 ${formatDuration(first)} 뒤였어요`]
    : [];
}

function habitFindings(a: Omit<RunAnalysis, "findings">): string[] {
  const out: string[] = [];
  if (a.behaviour.repeated >= 3) out.push(`같은 호출을 ${a.behaviour.repeated}번 되풀이했어요`);
  if (a.efficiency.failedCalls >= 3)
    out.push(`툴 호출 ${a.efficiency.failedCalls}번이 실패했어요 (잘못된 인자, 없는 장비 등)`);
  const changed = Object.entries(a.behaviour.actions).map(
    ([k, n]) => `${withJosa(ACTION_LABELS[k as ActionKind], "을")} ${n}번`,
  );
  if (changed.length > 0) out.push(`세계를 바꾼 조치: ${changed.join(", ")} 했어요`);
  return out;
}
