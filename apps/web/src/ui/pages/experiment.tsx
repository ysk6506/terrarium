/**
 * One experiment (REQ-030, REQ-037, REQ-038, REQ-040): live progress while it runs, then the numbers,
 * what was learned, each run, and the ways onward: share it, change a condition and run it again,
 * add more runs, or stop it.
 */
import type { ExperimentView } from "@terrarium/core/contract";
import { withJosa } from "@terrarium/core/kernel";
import { useState } from "react";
import { dateText, statusLabel } from "../../logic";
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
import {
  ConditionsPanel,
  CriteriaTable,
  EndReasons,
  Findings,
  Lineage,
  ParentCard,
  ResultFigures,
  RunsTable,
} from "./experiment-parts";
import { SubjectPanel } from "./experiment-subject";
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
      <Button kind="danger" icon="stop" onClick={() => setAsking(true)}>
        멈추기
      </Button>
      {asking && (
        <Dialog
          title="남은 실행을 멈출까요?"
          onClose={() => setAsking(false)}
          actions={
            <Button kind="danger" busy={busy} onClick={() => void cancel()}>
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
  const add = async () => {
    const next = await run(
      () => api.call("addRuns", { params: { id: view.experiment.id }, body: { count } }),
      `${count}회를 더했어요`,
    );
    if (next) onDone(next);
  };
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
      <Button busy={busy} onClick={() => void add()}>
        같은 조건으로 더 돌리기
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
          <Status status={view.status} /> {withJosa(e.owner, "이")}{" "}
          {dateText(e.createdAt, Date.now())}에 만들었어요. {view.progress.finished}/
          {view.progress.total}회 끝.
        </>
      }
      actions={
        <>
          {view.canCancel && active && <CancelButton view={view} onDone={onChange} />}
          <Go to={{ name: "newExperiment", forkOf: e.id }} className="btn btn-primary">
            조건 바꿔 다시 돌리기
          </Go>
          <ShareMenu view={view} />
        </>
      }
    />
  );
}

export function ExperimentPage({ id }: { readonly id: string }) {
  const { api } = useApp();
  const state = useAsync((signal) => api.call("getExperiment", { params: { id }, signal }), [id]);
  const view = state.data;
  usePageTitle(view?.experiment.name);
  const live = useLive(view, state.reload);
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
      <Head view={{ ...view, status }} onChange={state.set} />
      <ResultFigures a={view.analysis} />
      <p className="sr-only" aria-live="polite">
        {statusLabel(status)}, {view.progress.finished}/{view.progress.total}회 끝
      </p>
      <Findings items={view.analysis.findings} />
      {view.analysis.parent && (
        <ParentCard parent={view.analysis.parent} ready={view.analysis.progress.completed > 0} />
      )}
      <Section title="실행" aside=<EndReasons reasons={view.analysis.endReasons} />>
        {runs.length === 0 ? (
          <Empty title="아직 실행이 없어요" />
        ) : (
          <RunsTable runs={runs} live={live} analysis={view.analysis} />
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
