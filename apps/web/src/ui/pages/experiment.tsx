/**
 * One experiment (REQ-030, REQ-037, REQ-038, REQ-040, ADR-0171): live progress while it runs, then a result whose
 * first screen answers three questions (did it do well, where were points lost, can the score be trusted) and whose
 * other views are tabs in the address: 실행 (each run, and more of them), 업무 비교 and 세계 범위.
 */

import type { ExperimentView } from "@terrarium/core/contract";
import { withJosa } from "@terrarium/core/kernel";
import { useState } from "react";
import { dateText, type ResultTab, resultWords, statusLabel } from "../../logic";
import { experimentState, useMossScreen } from "../../moss";
import { Go, useApp, useAsync, useNow, usePageTitle } from "../context";
import { Button, Failure, Loading, PageHead, Status } from "../kit";
import { ScopeButton, ScopeTag, useOwnerName } from "../scope";
import { EscalationCards } from "./escalation";
import { CancelButton, ShareButton } from "./experiment-actions";
import { ExportDialog } from "./experiment-export";
import { RunsTab } from "./experiment-runs";
import { SummaryTab } from "./experiment-summary";
import { OperationCards } from "./operation-card";
import { ProcessCompare } from "./process-compare";
import { WorldOntology } from "./process-ontology";
import { useLive } from "./useLive";

const ACTIVE = new Set(["queued", "running"]);

/** One sentence under the title: what was tested, who ran it and when, and how far it got. */
function Meta({
  view,
  status,
  onScope,
}: {
  readonly view: ExperimentView;
  readonly status: ExperimentView["status"];
  readonly onScope: () => void;
}) {
  const e = view.experiment;
  const now = useNow();
  const ownerOf = useOwnerName();
  const what = e.recipe.operation ? "운영 실험" : `${e.snapshot.scenarioName} 시나리오`;
  return (
    <>
      <Status status={status} operation={e.recipe.operation !== undefined} /> {what},{" "}
      {e.snapshot.worldName}에서. {withJosa(ownerOf(e.owner), "이")} {dateText(e.createdAt, now)}에
      돌렸어요. {resultWords.progressLine(status, view.progress)}. <ScopeTag item={e} />
      {view.canChangeScope !== false && (
        <ScopeButton
          kind="experiment"
          id={e.id}
          name={e.name}
          owner={e.owner}
          current={{ scope: e.scope ?? "everyone", ...(e.group ? { group: e.group } : {}) }}
          onChanged={onScope}
        />
      )}
    </>
  );
}

function Head({
  view,
  status,
  onChange,
  onExport,
  onScope,
}: {
  readonly view: ExperimentView;
  readonly status: ExperimentView["status"];
  readonly onChange: (v: ExperimentView) => void;
  readonly onExport: () => void;
  readonly onScope: () => void;
}) {
  const e = view.experiment;
  return (
    <PageHead
      crumbs={<Go to={{ name: "experiments" }}>실험</Go>}
      title={e.name}
      lede={<Meta view={view} status={status} onScope={onScope} />}
      actions={
        <>
          {view.canCancel && ACTIVE.has(status) && <CancelButton view={view} onDone={onChange} />}
          <Go
            to={{ name: "newExperiment", forkOf: e.id }}
            className="btn btn-primary"
            data-moss-action="exp-fork"
          >
            조건 바꿔 다시 돌리기
          </Go>
          <Button data-moss-action="exp-export" onClick={onExport}>
            내보내기
          </Button>
          <ShareButton view={view} />
        </>
      }
    />
  );
}

const TAB_LABELS: Readonly<Record<ResultTab, string>> = {
  summary: "요약",
  runs: "실행",
  process: "업무 비교",
  world: "세계 범위",
};

/** The four views as links, so each has an address and the back button goes back to the one before. */
function Tabs({
  id,
  tab,
  runs,
}: {
  readonly id: string;
  readonly tab: ResultTab;
  readonly runs: number;
}) {
  return (
    <nav className="res-tabs" aria-label="결과 보기">
      {(Object.keys(TAB_LABELS) as ResultTab[]).map((t) => (
        <Go
          key={t}
          to={{ name: "experiment", id, tab: t }}
          className="res-tab"
          aria-current={t === tab ? "page" : undefined}
          data-moss-skip="탭은 이끼가 '탭 열기'로 열어요"
        >
          {t === "runs" ? `${TAB_LABELS.runs} ${runs}번` : TAB_LABELS[t]}
        </Go>
      ))}
    </nav>
  );
}

/** What a screen reader hears when the experiment's state changes. */
function LiveStatus({
  view,
  status,
}: {
  readonly view: ExperimentView;
  readonly status: ExperimentView["status"];
}) {
  return (
    <p className="sr-only" aria-live="polite">
      {statusLabel(status, Boolean(view.experiment.recipe.operation))},{" "}
      {resultWords.progressLine(status, view.progress)}
    </p>
  );
}

/** 이끼가 이 실험을 읽고 "실행 열기", "탭 열기", "내보내기"를 하는 길: 화면의 링크·단추와 같은 동작 (REQ-103) */
function useExperimentMoss(view: ExperimentView | undefined, openExport: () => void) {
  const { navigate } = useApp();
  useMossScreen("experiment", {
    read: () => (view ? experimentState(view) : {}),
    summary: () =>
      view
        ? `${view.experiment.name} · 남은 ${view.progress.total - view.progress.finished}번`
        : undefined,
    run: {
      "exp-open-run": (a) => {
        const runs = view?.runs ?? [];
        const n = typeof a.n === "number" ? a.n : 1;
        const hit = runs.find((r) => r.index + 1 === n) ?? runs[0];
        if (!hit) throw new Error("열 실행이 아직 없어요");
        navigate({ name: "run", id: hit.id });
        return `${hit.index + 1}번째 실행을 열었어요`;
      },
      "exp-tab": (a) => {
        // the words the person used pick the tab: 업무 비교, 세계 범위, 실행, else the summary
        const said = String(a.text ?? "");
        const tab =
          (Object.keys(TAB_LABELS) as ResultTab[]).find(
            (t) => t !== "summary" && said.includes(TAB_LABELS[t]),
          ) ?? "summary";
        if (view) navigate({ name: "experiment", id: view.experiment.id, tab });
        return `${TAB_LABELS[tab]} 탭을 열었어요`;
      },
      "exp-export": () => {
        openExport();
        return "내보내기를 열었어요";
      },
    },
  });
}

export function ExperimentPage({
  id,
  tab = "summary",
}: {
  readonly id: string;
  readonly tab?: ResultTab | undefined;
}) {
  const { api } = useApp();
  const [exporting, setExporting] = useState(false);
  const state = useAsync((signal) => api.call("getExperiment", { params: { id }, signal }), [id]);
  const view = state.data;
  usePageTitle(view?.experiment.name);
  const live = useLive(view, state.reload);
  useExperimentMoss(view, () => setExporting(true));
  if (state.error && !view)
    return (
      <div className="page">
        <Failure error={state.error} retry={state.reload} />
      </div>
    );
  if (!view)
    return (
      <div className="page">
        <Loading lines={5} />
      </div>
    );
  const runs = live?.runs.length ? live.runs : view.runs;
  const status = live?.summary?.status ?? view.status;
  return (
    <div className="page" data-status={status}>
      <Head
        view={view}
        status={status}
        onChange={state.set}
        onExport={() => setExporting(true)}
        onScope={state.reload}
      />
      <EscalationCards experimentId={id} />
      {view.experiment.recipe.operation && (
        <OperationCards
          runs={runs}
          worldId={view.experiment.recipe.worldId}
          hours={view.experiment.recipe.operation.hours}
        />
      )}
      <LiveStatus view={view} status={status} />
      <Tabs id={id} tab={tab} runs={runs.length} />
      {tab === "summary" && <SummaryTab view={view} runs={runs} status={status} />}
      {tab === "runs" && <RunsTab view={view} runs={runs} live={live} onChange={state.set} />}
      {tab === "process" && <ProcessCompare experimentId={id} finished={view.progress.finished} />}
      {tab === "world" && (
        <WorldOntology worldId={view.experiment.recipe.worldId} experimentId={id} />
      )}
      {exporting && <ExportDialog view={view} onClose={() => setExporting(false)} />}
    </div>
  );
}
