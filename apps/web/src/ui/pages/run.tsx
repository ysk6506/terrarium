/**
 * One run (REQ-037, REQ-038): what happened in the simulated world, what the agent did about it, how
 * it was scored, and, when its connection keeps traces somewhere, what the harness recorded.
 */

import type { RunView } from "@terrarium/core/contract";
import { END_REASON_LABELS } from "@terrarium/core/oracle";
import { BlueprintIndex } from "@terrarium/core/world";
import { useMemo, useState } from "react";
import {
  commonPathNote,
  formatDuration,
  PASS_RULE_TEXT,
  recoveryFigures,
  scoreText,
  scoringText,
} from "../../logic";
import { numberQuestion, runState, useMossActions, useMossScreen } from "../../moss";
import { Go, useApp, useAsync, usePageTitle } from "../context";
import { Failure, Figures, Loading, Note, PageHead, Section, Status, Tabs } from "../kit";
import { SeriesGrid, Timeline } from "../results";
import { RunReplay } from "../topology/RunReplay";
import { EscalationCards } from "./escalation";
import { HumanBlock, OutsideBlock, SopBlock } from "./run-blocks";
import { HandoffSection } from "./run-handoffs";
import { OperationResult } from "./run-operation";
import { CallsTable, DiagnosisCompare, ScoreSheet, TelemetryPanel } from "./run-parts";

type Tab = "timeline" | "calls" | "metrics" | "harness";

function Telemetry({
  id,
  has,
  name,
}: {
  readonly id: string;
  readonly has: boolean;
  /** The tool this run's connection keeps its traces in. */
  readonly name: string | undefined;
}) {
  const { api } = useApp();
  const t = useAsync(
    (signal) =>
      has ? api.call("runTelemetry", { params: { id }, signal }) : Promise.resolve(undefined),
    [id, has],
  );
  if (!has)
    return (
      <Note>
        이 연결에는 트레이스를 쌓는 곳이 정해져 있지 않거나, 이 실행이 추적 번호를 남기지 않았어요.
        연결 화면에서 '이 하네스의 트레이스는 어디에 쌓이나요?'를 골라 주세요.
      </Note>
    );
  if (t.error) return <Failure error={t.error} retry={t.reload} />;
  if (!t.data) return <Loading />;
  return <TelemetryPanel telemetry={t.data} {...(name ? { source: name } : {})} />;
}

function Metrics({
  worldId,
  series,
}: {
  readonly worldId: string;
  readonly series: Parameters<typeof SeriesGrid>[0]["series"];
}) {
  const { api } = useApp();
  const world = useAsync(
    (signal) => api.call("getWorld", { params: { id: worldId }, signal }),
    [worldId],
  );
  const index = useMemo(
    () => (world.data ? new BlueprintIndex(world.data.blueprint) : undefined),
    [world.data],
  );
  return <SeriesGrid series={series} {...(index ? { index } : {})} limit={12} />;
}

function RunHead({ view }: { readonly view: RunView }) {
  const { run, analysis, experiment } = view;
  const operation = experiment.experiment.recipe.operation !== undefined;
  const ended = analysis.endReason
    ? (analysis.endLabel ?? END_REASON_LABELS[analysis.endReason])
    : run.status === "running"
      ? "아직 돌고 있어요"
      : "";
  return (
    <PageHead
      crumbs={
        <>
          <Go to={{ name: "experiments" }}>실험</Go> /{" "}
          <Go to={{ name: "experiment", id: run.experimentId }}>{experiment.experiment.name}</Go>
        </>
      }
      title={`${run.index + 1}번째 실행 (상황 ${run.seed})`}
      lede={
        <>
          <Status status={run.status} operation={operation} /> {ended}
        </>
      }
    />
  );
}

function RunFigures({ view }: { readonly view: RunView }) {
  const { analysis, run } = view;
  const e = analysis.efficiency;
  const tokens =
    e.inputTokens === undefined
      ? "—"
      : ((e.inputTokens ?? 0) + (e.outputTokens ?? 0)).toLocaleString("ko-KR");
  const after = analysis.diagnosis.afterSeconds;
  return (
    <Figures
      items={[
        // a scenario with services starts with how the services did (REQ-088)
        ...recoveryFigures(run.result?.score),
        {
          label: "점수",
          value: scoreText(analysis.score),
          ask: numberQuestion("이 실행", scoreText(analysis.score)),
          hint: run.result?.score.summary || "채점표 항목의 점수를 더한 값",
        },
        {
          label: "합격",
          value: run.result ? (analysis.passed ? "합격" : "불합격") : "—",
          hint: PASS_RULE_TEXT,
        },
        {
          label: "진단까지",
          value: after === undefined ? "—" : formatDuration(after),
          hint: "시뮬레이션 시간",
        },
        {
          label: "조사 호출",
          value: `${e.investigationCalls}회`,
          hint: `실패한 호출 ${e.failedCalls}회`,
        },
        {
          label: "같은 호출 반복",
          value: `${analysis.behaviour.repeated}회`,
          hint: "같은 툴을 같은 인자로 다시 부른 횟수",
        },
        {
          label: "토큰",
          value: tokens,
          hint: "하네스가 알려 준 입력과 출력 토큰의 합",
        },
      ]}
    />
  );
}

function Verdicts({ view }: { readonly view: RunView }) {
  const result = view.run.result;
  return (
    <>
      {view.analysis.findings.length > 0 && (
        <Section title="알아낸 것">
          <ul className="list-plain">
            {view.analysis.findings.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </Section>
      )}
      {result && (
        <Section title="진단과 정답">
          <DiagnosisCompare view={view} />
        </Section>
      )}
      {result && (
        <Section
          title="채점표"
          aside={
            <span className="tiny muted">
              {scoringText(result.score)} · 채점 버전 {result.score.version}
            </span>
          }
        >
          <ScoreSheet items={result.score.items} />
        </Section>
      )}
    </>
  );
}

const TAB_WORDS: Readonly<Record<string, Tab>> = {
  timeline: "timeline",
  일어난: "timeline",
  calls: "calls",
  툴: "calls",
  metrics: "metrics",
  지표: "metrics",
  harness: "harness",
  하네스: "harness",
};

function Records({ view }: { readonly view: RunView }) {
  const [tab, setTab] = useState<Tab>("timeline");
  // 이끼가 기록 탭을 넘길 때 쓰는 핸들러: 탭 버튼과 같은 setTab (REQ-103)
  useMossActions("run", {
    "run-show-tab": (args) => {
      const text = String(args.tab ?? args.text ?? "");
      const hit = Object.entries(TAB_WORDS).find(([word]) => text.includes(word));
      setTab(hit ? hit[1] : "calls");
      return `${hit ? hit[0] : "툴 호출"} 탭을 열었어요`;
    },
  });
  const result = view.run.result;
  const worldId = view.experiment.experiment.recipe.worldId;
  return (
    <section className="section" aria-label="기록">
      <Tabs
        label="기록 보기"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "timeline", label: `일어난 일 (${view.timeline.length})` },
          { id: "calls", label: `툴 호출 (${result?.toolCalls.length ?? 0})` },
          { id: "metrics", label: "지표" },
          { id: "harness", label: "하네스 기록" },
        ]}
      >
        {tab === "timeline" && <Timeline entries={view.timeline} />}
        {tab === "calls" && <CallsTable view={view} />}
        {tab === "metrics" && <Metrics worldId={worldId} series={result?.series ?? []} />}
        {tab === "harness" && (
          <Telemetry id={view.run.id} has={view.hasTelemetry} name={view.telemetryName} />
        )}
      </Tabs>
    </section>
  );
}

/** The replay of the run, from the moment it starts: live while it goes, the whole of it once it is over. */
function Replay({ view, reload }: { readonly view: RunView; readonly reload: () => void }) {
  const { run } = view;
  if (run.status !== "running" && !run.result) return null;
  return (
    <RunReplay
      runId={run.id}
      worldId={view.experiment.experiment.recipe.worldId}
      live={run.status === "running"}
      onEnd={reload}
    />
  );
}

export function RunPage({ id }: { readonly id: string }) {
  const { api } = useApp();
  const state = useAsync((signal) => api.call("getRun", { params: { id }, signal }), [id]);
  const view = state.data;
  usePageTitle(view && `${view.run.index + 1}번째 실행, ${view.experiment.experiment.name}`);
  const { navigate } = useApp();
  useMossScreen("run", {
    read: () => (view ? runState(view) : {}),
    run: {
      "run-open-experiment": () =>
        view && navigate({ name: "experiment", id: view.run.experimentId }),
      "run-read-scores": () =>
        view?.run.result
          ? view.run.result.score.items
              .map((i) => `${i.label} ${i.points}/${i.max || "감점"}점`)
              .join(", ")
          : "아직 채점 전이에요",
    },
  });
  return (
    <div className="page">
      {state.error && !view && <Failure error={state.error} retry={state.reload} />}
      {!view && !state.error && <Loading lines={5} />}
      {view && (
        <>
          <RunHead view={view} />
          {view.run.error && <Note tone="bad">{view.run.error}</Note>}
          <EscalationCards runId={id} />
          {view.run.result?.operation ? (
            <OperationResult view={view} />
          ) : (
            <RunFigures view={view} />
          )}
          <HumanBlock result={view.run.result} />
          <SopBlock result={view.run.result} />
          <OutsideBlock result={view.run.result} />
          {commonPathNote(view.commonReach) && (
            <Note tone="warn">{commonPathNote(view.commonReach)}</Note>
          )}
          <Replay view={view} reload={state.reload} />
          <HandoffSection view={view} live={view.run.status === "running"} />
          {!view.run.result?.operation && <Verdicts view={view} />}
          <Records view={view} />
        </>
      )}
    </div>
  );
}
