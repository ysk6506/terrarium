/**
 * Towards a digital twin (REQ-015). Every finished run leaves a diagnosis record: what was really
 * wrong, what the agent said, and how it got there. Records are exported as JSON Lines for
 * meta-analysis elsewhere, and summarised into a modelling brief — a Markdown hand-off for the agent
 * that develops the simulator, pointing at where the world is too easy, too hard or too thin.
 */
import type { Experiment, RunRecord } from "@terrarium/core/experiments";
import { josa } from "@terrarium/core/kernel";
import { investigationCalls } from "@terrarium/core/oracle";
import { tallyGaps } from "@terrarium/core/world";
import { ratio } from "./stats";

export const DIAGNOSIS_SCHEMA = "terrarium.diagnosis/1";

export interface DiagnosisRecord {
  readonly schema: typeof DIAGNOSIS_SCHEMA;
  readonly experimentId: string;
  readonly runId: string;
  readonly seed: number;
  readonly owner: string;
  readonly benchmarkKey: string;
  readonly world: { readonly id: string; readonly name: string; readonly digest: string };
  readonly scenario: { readonly id: string; readonly name: string; readonly digest: string };
  readonly oracle: string;
  readonly harnessId: string;
  readonly agentId: string;
  readonly tools: readonly string[];
  /** Accepted answers; null when the scenario asked for no diagnosis. */
  readonly truth: {
    readonly rootCause: readonly string[];
    readonly faultType: readonly string[];
  } | null;
  readonly submitted: {
    readonly rootCause: string;
    readonly faultType: string;
    readonly summary: string;
    readonly actions: readonly string[];
    readonly confidence?: number;
  } | null;
  readonly correct: { readonly root: boolean; readonly type: boolean } | null;
  /** Simulated seconds from the task to the diagnosis. */
  readonly afterSeconds: number | null;
  readonly score: number | null;
  readonly passed: boolean;
  readonly endReason: string;
  readonly calls: {
    readonly total: number;
    readonly investigation: number;
    readonly failed: number;
  };
  readonly toolErrors: readonly { readonly tool: string; readonly error: string }[];
  /**
   * The emulation gaps the run hit (ADR-0184), counted by key, most frequent first: where the proving ground, not the
   * agent, fell short. Left out when there were none; carries only keys and counts, never a command or a row.
   */
  readonly gaps?: readonly {
    readonly tool: string;
    readonly feature: string;
    readonly n: number;
  }[];
  readonly finishedAt: string | null;
}

/** One record per completed run; failed and cancelled runs say nothing about diagnosis. */
export function diagnosisRecords(
  experiment: Experiment,
  runs: readonly RunRecord[],
): DiagnosisRecord[] {
  return runs.flatMap((run) =>
    run.status === "completed" && run.result ? [record(experiment, run)] : [],
  );
}

function record(e: Experiment, run: RunRecord): DiagnosisRecord {
  const result = run.result as NonNullable<RunRecord["result"]>;
  const facts = result.score.items.find((i) => i.kind === "diagnosis")?.facts;
  const d = result.diagnosis;
  return {
    schema: DIAGNOSIS_SCHEMA,
    experimentId: e.id,
    runId: run.id,
    seed: run.seed,
    owner: e.owner,
    benchmarkKey: e.benchmarkKey,
    world: { id: e.recipe.worldId, name: e.snapshot.worldName, digest: result.digests.world },
    scenario: {
      id: e.recipe.scenarioId,
      name: e.snapshot.scenarioName,
      digest: result.digests.scenario,
    },
    oracle: result.digests.oracle,
    harnessId: e.recipe.harnessId,
    agentId: e.recipe.agentId,
    tools: e.recipe.tools,
    truth: facts ? { rootCause: facts.rootCause, faultType: facts.faultType } : null,
    submitted: d
      ? {
          rootCause: d.rootCause,
          faultType: d.faultType,
          summary: d.summary,
          actions: d.actions,
          ...(d.confidence !== undefined ? { confidence: d.confidence } : {}),
        }
      : null,
    correct: facts ? { root: facts.root, type: facts.type } : null,
    afterSeconds:
      result.diagnosedAt !== undefined ? result.diagnosedAt - result.task.startedAt : null,
    score: result.score.total,
    passed: result.score.passed,
    endReason: result.endReason,
    calls: {
      total: result.toolCalls.length,
      investigation: investigationCalls(result.toolCalls),
      failed: result.toolCalls.filter((c) => !c.ok).length,
    },
    toolErrors: result.toolCalls
      .filter((c) => !c.ok)
      .map((c) => ({ tool: c.tool, error: c.error ?? "알 수 없는 오류" })),
    ...gapsOf(result.toolCalls),
    finishedAt: run.finishedAt ?? null,
  };
}

/** The run's emulation gaps by key (nothing when there were none, so a record without gaps keeps its old shape). */
function gapsOf(
  calls: NonNullable<RunRecord["result"]>["toolCalls"],
): Pick<DiagnosisRecord, "gaps"> {
  const gaps = tallyGaps(calls.flatMap((c) => c.gaps ?? []));
  return gaps.length > 0 ? { gaps } : {};
}

/** JSON Lines: one record per line, stable key order, newline-terminated. */
export function toJsonl(records: readonly DiagnosisRecord[]): string {
  return records.map((r) => JSON.stringify(r)).join("\n") + (records.length > 0 ? "\n" : "");
}

export function fromJsonl(text: string): DiagnosisRecord[] {
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line, i) => {
      const parsed = JSON.parse(line) as Partial<DiagnosisRecord>;
      if (parsed.schema !== DIAGNOSIS_SCHEMA)
        throw new Error(`${i + 1}번째 줄은 진단 기록(${DIAGNOSIS_SCHEMA})이 아니에요`);
      return parsed as DiagnosisRecord;
    });
}

export interface FaultTypeStats {
  readonly faultType: string;
  readonly runs: number;
  readonly agents: number;
  readonly rootRate: number;
  readonly typeRate: number;
  /** Wrong fault types agents named, most frequent first. */
  readonly confusedWith: readonly { readonly faultType: string; readonly count: number }[];
}

export interface ToolErrorStats {
  readonly tool: string;
  /** The message with ids and numbers blanked, so the same failure groups together. */
  readonly pattern: string;
  readonly count: number;
  readonly example: string;
}

/** Ids, quoted names and numbers vary between runs; the shape of the message does not. */
export function errorPattern(message: string): string {
  return message
    .replace(/'[^']*'|"[^"]*"/g, "'…'")
    .replace(/\b[a-z]+(?:-[a-z0-9]+)*-\d+[a-z0-9-]*\b/gi, "#id")
    .replace(/\d+(?:\.\d+)?/g, "#");
}

export function faultTypeStats(records: readonly DiagnosisRecord[]): FaultTypeStats[] {
  const byType = new Map<string, DiagnosisRecord[]>();
  for (const r of records) {
    if (!r.truth) continue;
    const key = r.truth.faultType.join(" / ");
    byType.set(key, [...(byType.get(key) ?? []), r]);
  }
  return [...byType]
    .map(([faultType, rs]) => {
      const wrong = new Map<string, number>();
      for (const r of rs)
        if (r.submitted && !r.correct?.type)
          wrong.set(r.submitted.faultType, (wrong.get(r.submitted.faultType) ?? 0) + 1);
      return {
        faultType,
        runs: rs.length,
        agents: new Set(rs.map((r) => `${r.harnessId}|${r.agentId}`)).size,
        rootRate: ratio(rs.filter((r) => r.correct?.root).length, rs.length),
        typeRate: ratio(rs.filter((r) => r.correct?.type).length, rs.length),
        confusedWith: [...wrong]
          .map(([type, count]) => ({ faultType: type, count }))
          .sort((a, b) => b.count - a.count || a.faultType.localeCompare(b.faultType)),
      };
    })
    .sort((a, b) => a.typeRate - b.typeRate || b.runs - a.runs);
}

export function toolErrorStats(records: readonly DiagnosisRecord[]): ToolErrorStats[] {
  const groups = new Map<string, ToolErrorStats>();
  for (const r of records)
    for (const e of r.toolErrors) {
      const pattern = errorPattern(e.error);
      const key = `${e.tool}|${pattern}`;
      const prev = groups.get(key);
      groups.set(key, {
        tool: e.tool,
        pattern,
        count: (prev?.count ?? 0) + 1,
        example: prev?.example ?? e.error,
      });
    }
  return [...groups.values()].sort((a, b) => b.count - a.count || a.tool.localeCompare(b.tool));
}

const pct = (r: number) => `${Math.round(r * 100)}%`;
const LOW_ACCURACY = 0.5;

function faultSection(stats: readonly FaultTypeStats[]): string[] {
  if (stats.length === 0) return ["진단을 요구한 실행이 아직 없어요.", ""];
  const out = [
    "| 실제 고장 종류 | 실행 | 에이전트 | 원인 장비 정답률 | 고장 종류 정답률 | 자주 헷갈린 답 |",
    "|---|---|---|---|---|---|",
  ];
  for (const s of stats) {
    const confused =
      s.confusedWith
        .slice(0, 3)
        .map((c) => `${c.faultType} (${c.count})`)
        .join(", ") || "—";
    out.push(
      `| ${s.faultType} | ${s.runs} | ${s.agents} | ${pct(s.rootRate)} | ${pct(s.typeRate)} | ${confused} |`,
    );
  }
  return [...out, ""];
}

function suggestions(
  stats: readonly FaultTypeStats[],
  errors: readonly ToolErrorStats[],
): string[] {
  const out: string[] = [];
  for (const s of stats.filter((x) => x.typeRate < LOW_ACCURACY && x.agents >= 2))
    out.push(
      `'${s.faultType}'${josa(s.faultType, "은")} 에이전트 ${s.agents}종에 걸쳐 정답률이 ${pct(s.typeRate)}에 그쳐요. 이 고장이 만드는 관측 신호(센서·알람·이벤트)가 다른 고장과 구별되는지 확인해 주세요.`,
    );
  for (const s of stats.filter((x) => x.typeRate === 1 && x.runs >= 5))
    out.push(
      `'${s.faultType}'${josa(s.faultType, "은")} ${s.runs}번 모두 맞혔어요. 현실보다 단서가 너무 뚜렷하지 않은지 봐요.`,
    );
  for (const e of errors.slice(0, 5))
    out.push(
      `툴 \`${e.tool}\`${josa(e.tool, "이")} 같은 오류를 ${e.count}번 냈어요: "${e.example}". 에이전트가 기대한 동작을 시뮬레이터가 지원해야 하는지 판단해요.`,
    );
  return out.length > 0
    ? out.map((s) => `- ${s}`)
    : ["- 지금 기록으로는 특별히 손볼 곳이 보이지 않아요."];
}

export interface BriefInput {
  readonly records: readonly DiagnosisRecord[];
  readonly generatedAt?: string;
}

/** A Markdown hand-off for the agent that develops the simulator. */
export function modelingBrief(input: BriefInput): string {
  const { records } = input;
  const faults = faultTypeStats(records);
  const errors = toolErrorStats(records);
  const diagnosed = records.filter((r) => r.truth);
  const agents = new Set(records.map((r) => `${r.harnessId}|${r.agentId}`)).size;
  const lines = [
    "# 시뮬레이터 모델링 브리프",
    "",
    "테라리움에서 에이전트들이 고장을 진단한 기록을 모은 것이에요. 시뮬레이터를 고치는 쪽에서, 세계가 현실보다 쉽거나 어렵거나 비어 있는 곳을 찾는 데 써요.",
    "",
    `- 실행 ${records.length}번 (진단 요구 ${diagnosed.length}번), 실험 ${new Set(records.map((r) => r.experimentId)).size}개, 에이전트 ${agents}종`,
    `- 세계 ${new Set(records.map((r) => r.world.digest)).size}개 버전, 시나리오 ${new Set(records.map((r) => r.scenario.digest)).size}개 버전`,
    ...(input.generatedAt ? [`- 작성 ${input.generatedAt}`] : []),
    "",
    "## 고장 종류별 진단 정확도",
    "",
    "정답률이 낮은 순서예요. 여러 에이전트가 함께 틀리는 고장은 에이전트보다 시뮬레이터의 단서가 부족한 탓일 수 있어요.",
    "",
    ...faultSection(faults),
    "## 툴 오류",
    "",
    ...(errors.length === 0
      ? ["툴 오류가 없었어요.", ""]
      : [
          "| 툴 | 오류 형태 | 몇 번 | 예 |",
          "|---|---|---|---|",
          ...errors.map(
            (e) =>
              `| \`${e.tool}\` | ${e.pattern} | ${e.count} | ${e.example.replace(/\|/g, "\\|")} |`,
          ),
          "",
        ]),
    "## 다음에 볼 곳",
    "",
    ...suggestions(faults, errors),
    "",
  ];
  return lines.join("\n");
}
