/**
 * One experiment (REQ-030, REQ-037, REQ-038, REQ-040): live progress while it runs, then the numbers,
 * what was learned, each run, and the ways onward: share it, change a condition and run it again,
 * add more runs, or stop it.
 */

import type { ExperimentView, RunSummary } from "@terrarium/core/contract";
import { repeatsOf, sizeProblemsOf } from "@terrarium/core/experiments";
import { withJosa } from "@terrarium/core/kernel";
import { useState } from "react";
import { dateText, hallTopology, statusLabel } from "../../logic";
import { experimentState, useMossActions, useMossScreen } from "../../moss";
import { Go, useAction, useApp, useAsync, usePageTitle } from "../context";
import {
  Button,
  Dialog,
  Empty,
  Failure,
  Loading,
  MenuButton,
  NumberField,
  PageHead,
  Section,
  Status,
} from "../kit";
import { CompareRuns } from "../topology/RunReplay";
import { EscalationCards } from "./escalation";
import {
  ConditionsPanel,
  CriteriaTable,
  EndReasons,
  Findings,
  Lineage,
  ParentCard,
  ResultFigures,
  RunsTable,
  SeedRows,
} from "./experiment-parts";
import { SubjectPanel } from "./experiment-subject";
import { OperationCards } from "./operation-card";
import { ProcessSections } from "./process-compare";
import { useLive } from "./useLive";

const ACTIVE = new Set(["queued", "running"]);

function ShareMenu({ view }: { readonly view: ExperimentView }) {
  const { api, toast } = useApp();
  const id = view.experiment.id;
  const copy = async (text: string, done: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast(done);
    } catch {
      toast("복사하지 못했어요. 브라우저가 클립보드를 막고 있어요", "bad");
    }
  };
  const shareLink = async () => {
    try {
      const share = await api.call("createShare", { params: { id }, body: {} });
      await copy(share.url, "링크를 복사했어요. 받은 사람은 로그인 없이 보고서를 볼 수 있어요");
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "bad");
    }
  };
  const copyText = async () => {
    try {
      await copy(
        await api.call("experimentReport", { params: { id }, query: { format: "text" } }),
        "보고서 글을 복사했어요",
      );
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "bad");
    }
  };
  return (
    <MenuButton
      label="공유"
      icon="share"
      items={[
        {
          label: "링크 복사",
          hint: "로그인 없이 보고서가 열려요",
          onSelect: () => void shareLink(),
        },
        {
          label: "HTML 보고서 열기",
          hint: "한 파일로 저장해 메일에 붙일 수 있어요",
          onSelect: () =>
            window.open(
              api.url("experimentReport", { id }, { format: "html" }),
              "_blank",
              "noopener",
            ),
        },
        { label: "글로 복사", hint: "메신저에 붙여 넣기 좋아요", onSelect: () => void copyText() },
      ]}
    />
  );
}

function CancelButton({
  view,
  onDone,
}: {
  readonly view: ExperimentView;
  readonly onDone: (v: ExperimentView) => void;
}) {
  const { api } = useApp();
  const { busy, run } = useAction();
  const [asking, setAsking] = useState(false);
  const remaining = view.progress.total - view.progress.finished;
  // 이끼의 "실험 멈추기": 같은 호출이고, 확인은 이끼의 "이렇게 할게요" 카드가 해요 (REQ-103)
  useMossActions("experiment", {
    "exp-cancel": async () => {
      const next = await run(
        () => api.call("cancelExperiment", { params: { id: view.experiment.id } }),
        "남은 실행을 멈췄어요",
      );
      if (next) onDone(next);
    },
  });
  const cancel = async () => {
    const next = await run(
      () => api.call("cancelExperiment", { params: { id: view.experiment.id } }),
      "남은 실행을 멈췄어요",
    );
    setAsking(false);
    if (next) onDone(next);
  };
  return (
    <>
      <Button
        kind="danger"
        icon="stop"
        data-moss-action="exp-cancel"
        onClick={() => setAsking(true)}
      >
        멈추기
      </Button>
      {asking && (
        <Dialog
          title="남은 실행을 멈출까요?"
          onClose={() => setAsking(false)}
          actions={
            <Button
              data-moss-action="exp-cancel"
              kind="danger"
              busy={busy}
              onClick={() => void cancel()}
            >
              {remaining}회 멈추기
            </Button>
          }
        >
          <p className="small">
            끝난 실행의 결과는 그대로 남아요. 돌고 있는 실행은 바로 멈추고, 기다리는 실행은 빠져요.
          </p>
        </Dialog>
      )}
    </>
  );
}

function AddRuns({
  view,
  onDone,
}: {
  readonly view: ExperimentView;
  readonly onDone: (v: ExperimentView) => void;
}) {
  const { api } = useApp();
  const { busy, run } = useAction();
  const [count, setCount] = useState(3);
  const { seeds, repeats } = {
    seeds: view.experiment.recipe.seeds.length,
    repeats: repeatsOf(view.experiment.recipe),
  };
  const more = async (body: { count: number } | { repeats: number }, done: string) => {
    const next = await run(
      () => api.call("addRuns", { params: { id: view.experiment.id }, body }),
      done,
    );
    if (next) onDone(next);
  };
  // each way of adding is held to the size limit before it is tried, and says why when it cannot be
  const seedsWhy = sizeProblemsOf(seeds + count, repeats)[0];
  const repeatsWhy = sizeProblemsOf(seeds, repeats + 1)[0];
  return (
    <div className="row" style={{ alignItems: "flex-end" }}>
      <div style={{ width: 140 }}>
        <NumberField
          label="더 돌릴 횟수"
          value={count}
          min={1}
          max={20}
          step={1}
          unit="회"
          onChange={(v) => v !== undefined && setCount(Math.round(v))}
        />
      </div>
      <Button
        data-moss-skip="세부 조절"
        busy={busy}
        disabled={seedsWhy !== undefined}
        why={seedsWhy}
        onClick={() => void more({ count }, `${count}회를 더했어요`)}
      >
        같은 조건으로 더 돌리기
        {repeats > 1 ? ` (실행 ${count * repeats}번)` : ""}
      </Button>
      <Button
        data-moss-skip="세부 조절"
        busy={busy}
        disabled={repeatsWhy !== undefined}
        why={repeatsWhy}
        onClick={() => void more({ repeats: 1 }, `상황마다 한 번씩 더했어요`)}
      >
        {`상황마다 한 번씩 더 돌리기 (실행 ${seeds}번)`}
      </Button>
    </div>
  );
}

function Head({
  view,
  onChange,
}: {
  readonly view: ExperimentView;
  readonly onChange: (v: ExperimentView) => void;
}) {
  const e = view.experiment;
  const active = ACTIVE.has(view.status);
  return (
    <PageHead
      crumbs={<Go to={{ name: "experiments" }}>실험</Go>}
      title={e.name}
      lede={
        <>
          <Status status={view.status} operation={e.recipe.operation !== undefined} />{" "}
          {withJosa(e.owner, "이")} {dateText(e.createdAt, Date.now())}에 만들었어요.{" "}
          {view.progress.finished}/{view.progress.total}회 끝.
        </>
      }
      actions={
        <>
          {view.canCancel && active && <CancelButton view={view} onDone={onChange} />}
          <Go
            to={{ name: "newExperiment", forkOf: e.id }}
            className="btn btn-primary"
            data-moss-action="exp-fork"
          >
            조건 바꿔 다시 돌리기
          </Go>
          <ShareMenu view={view} />
        </>
      }
    />
  );
}

/** Two ticked runs and the button that lays them side by side. */
function SideBySide({
  runs,
  worldId,
  picked,
  onPicked,
}: {
  readonly runs: readonly RunSummary[];
  readonly worldId: string;
  readonly picked: readonly string[];
  readonly onPicked: (ids: readonly string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const chosen = picked.flatMap((id) => runs.find((r) => r.id === id) ?? []);
  const [a, b] = chosen;
  return (
    <div style={{ marginTop: 16 }}>
      <Button
        data-moss-skip="세부 조절"
        size="small"
        disabled={!(a && b)}
        why={hallTopology.TOPO_WORDS.pickTwo}
        onClick={() => setOpen(true)}
      >
        {hallTopology.TOPO_WORDS.sideBySide}
      </Button>
      {open && a && b && (
        <CompareRuns
          worldId={worldId}
          runs={[
            { id: a.id, index: a.index },
            { id: b.id, index: b.index },
          ]}
          onClose={() => {
            setOpen(false);
            onPicked([]);
          }}
        />
      )}
    </div>
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
      {statusLabel(status, Boolean(view.experiment.recipe.operation))}, {view.progress.finished}/
      {view.progress.total}회 끝
    </p>
  );
}

/** 이끼가 이 실험을 읽고 "실행 열기"를 하는 길: 실행 표의 링크와 같은 `navigate` (REQ-103) */
function useExperimentMoss(view: ExperimentView | undefined) {
  const { navigate } = useApp();
  useMossScreen("experiment", {
    read: () => (view ? experimentState(view) : {}),
    summary: () =>
      view
        ? `${view.experiment.name} · 남은 ${view.progress.total - view.progress.finished}회`
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
    },
  });
}

function Figures({ view }: { readonly view: ExperimentView }) {
  if (view.experiment.recipe.operation)
    return (
      <p className="small muted">
        운영 실험은 실행마다 결과 화면에서 서비스 가용률, 놓친 알람, 탐지 지연을 봐요. 합격이나
        점수는 없어요.
      </p>
    );
  return (
    <>
      <ResultFigures a={view.analysis} />
    </>
  );
}

export function ExperimentPage({ id }: { readonly id: string }) {
  const { api } = useApp();
  const [picked, setPicked] = useState<readonly string[]>([]);
  const pick = (runId: string) =>
    setPicked((p) => (p.includes(runId) ? p.filter((x) => x !== runId) : [...p, runId].slice(-2)));
  const state = useAsync((signal) => api.call("getExperiment", { params: { id }, signal }), [id]);
  const view = state.data;
  usePageTitle(view?.experiment.name);
  const live = useLive(view, state.reload);
  useExperimentMoss(view);
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
    <div className="page page-full" data-status={status}>
      <Head view={{ ...view, status }} onChange={state.set} />
      <EscalationCards experimentId={id} />
      {view.experiment.recipe.operation && (
        <OperationCards
          runs={runs}
          worldId={view.experiment.recipe.worldId}
          hours={view.experiment.recipe.operation.hours}
        />
      )}
      <Figures view={view} />
      <LiveStatus view={view} status={status} />
      <Findings items={view.analysis.findings} />
      {view.analysis.parent && (
        <ParentCard parent={view.analysis.parent} ready={view.analysis.progress.completed > 0} />
      )}
      <SeedRows runs={runs} analysis={view.analysis} />
      <ProcessSections view={view} />
      <Section title="실행" aside=<EndReasons analysis={view.analysis} />>
        {runs.length === 0 ? (
          <Empty title="아직 실행이 없어요" />
        ) : (
          <RunsTable
            runs={runs}
            live={live}
            analysis={view.analysis}
            picked={picked}
            onPick={pick}
          />
        )}
        {runs.length > 1 && (
          <SideBySide
            runs={runs}
            worldId={view.experiment.recipe.worldId}
            picked={picked}
            onPicked={setPicked}
          />
        )}
        <div style={{ marginTop: 16 }}>
          <AddRuns view={view} onDone={state.set} />
        </div>
      </Section>
      <CriteriaTable criteria={view.analysis.criteria} />
      <SubjectPanel experiment={view.experiment} />
      <ConditionsPanel view={view} />
      <Lineage view={view} />
    </div>
  );
}
