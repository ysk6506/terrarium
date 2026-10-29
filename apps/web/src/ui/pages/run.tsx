/**
 * One run (REQ-037, REQ-038): what happened in the simulated world, what the agent did about it, how
 * it was scored, and, when ClickStack has it, what the harness recorded.
 */

import type { RunView } from "@terrarium/core/contract";
import { END_REASON_LABELS } from "@terrarium/core/oracle";
import { BlueprintIndex } from "@terrarium/core/world";
import { useMemo, useState } from "react";
import { formatDuration, scoreText } from "../../logic";
import { Go, useApp, useAsync, usePageTitle } from "../context";
import { Failure, Figures, Loading, Note, PageHead, Section, Status, Tabs } from "../kit";
import { SeriesGrid, Timeline } from "../results";
import { CallsTable, DiagnosisCompare, ScoreSheet, TelemetryPanel } from "./run-parts";

type Tab = "timeline" | "calls" | "metrics" | "harness";

function Telemetry({ id, has }: { readonly id: string; readonly has: boolean }) {
  const { api } = useApp();
  const t = useAsync(
    (signal) =>
      has ? api.call("runTelemetry", { params: { id }, signal }) : Promise.resolve(undefined),
    [id, has],
  );
  if (!has)
    return (
      <Note>
        이 실행은 하네스의 추적 번호를 알려 주지 않았거나, ClickStack이 연결되어 있지 않다.
      </Note>
    );
  if (t.error) return <Failure error={t.error} retry={t.reload} />;
  if (!t.data) return <Loading />;
  return <TelemetryPanel telemetry={t.data} />;
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
  const ended = analysis.endReason
    ? END_REASON_LABELS[analysis.endReason]
    : run.status === "running"
      ? "아직 돌고 있다"
      : "";
  return (
    <PageHead
      crumbs={
        <>
          <Go to={{ name: "experiments" }}>실험</Go> /{" "}
          <Go to={{ name: "experiment", id: run.experimentId }}>{experiment.experiment.name}</Go>
        </>
      }
      title={`${run.index + 1}번째 실행 (시드 ${run.seed})`}
      lede={
        <>
          <Status status={run.status} /> {ended}
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
        {
          label: "점수",
          value: scoreText(analysis.score),
          hint: run.result?.score.summary || "채점표 항목의 점수를 더한 값",
        },
        {
          label: "합격",
          value: run.result ? (analysis.passed ? "합격" : "불합격") : "—",
          hint: "70점 이상이면 합격이다",
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
          aside={<span className="tiny muted">채점 버전 {result.score.version}</span>}
        >
          <ScoreSheet items={result.score.items} />
        </Section>
      )}
    </>
  );
}

function Records({ view }: { readonly view: RunView }) {
  const [tab, setTab] = useState<Tab>("timeline");
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
        {tab === "harness" && <Telemetry id={view.run.id} has={view.hasTelemetry} />}
      </Tabs>
    </section>
  );
}

export function RunPage({ id }: { readonly id: string }) {
  const { api } = useApp();
  const state = useAsync((signal) => api.call("getRun", { params: { id }, signal }), [id]);
  const view = state.data;
  usePageTitle(view && `${view.run.index + 1}번째 실행, ${view.experiment.experiment.name}`);
  return (
    <div className="page">
      {state.error && !view && <Failure error={state.error} retry={state.reload} />}
      {!view && !state.error && <Loading lines={5} />}
      {view && (
        <>
          <RunHead view={view} />
          {view.run.error && <Note tone="bad">{view.run.error}</Note>}
          <RunFigures view={view} />
          <Verdicts view={view} />
          <Records view={view} />
        </>
      )}
    </div>
  );
}
