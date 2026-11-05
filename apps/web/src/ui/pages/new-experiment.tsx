/**
 * Making an experiment (REQ-030), or forking one (REQ-040): the form on the left, and on the right what
 * will run, what is still missing, and — for a fork — exactly what differs from the original.
 */
import type { ExperimentView } from "@terrarium/core/contract";
import type { WorldSummary } from "@terrarium/core/experiments";
import { useCallback, useEffect, useState } from "react";
import { experiment, metaProblems } from "../../logic";
import { Go, messageOf, useApp, useAsync } from "../context";
import { Button, Failure, Loading, Note, PageHead } from "../kit";
import { HowStep, NameStep, WhatStep, WhoStep } from "./experiment-steps";

type Draft = experiment.Draft;

interface Start {
  readonly worlds: readonly WorldSummary[];
  readonly parent?: ExperimentView;
  readonly draft: Draft;
}

/** Where the form starts: a fork's parent as it was, a chosen scenario, or empty. */
function useStart(forkOf?: string, scenarioId?: string) {
  const { api } = useApp();
  return useAsync(
    async (signal): Promise<Start> => {
      const worlds = await api.call("listWorlds", { signal });
      if (forkOf) {
        const parent = await api.call("getExperiment", { params: { id: forkOf }, signal });
        return { worlds, parent, draft: experiment.draftFrom(parent.experiment) };
      }
      if (scenarioId) {
        const s = await api.call("getScenario", { params: { id: scenarioId }, signal });
        return {
          worlds,
          draft: { ...experiment.emptyDraft(), worldId: s.worldId, scenarioId: s.id },
        };
      }
      return {
        worlds,
        draft: { ...experiment.emptyDraft(), ...(worlds[0] ? { worldId: worlds[0].id } : {}) },
      };
    },
    [forkOf, scenarioId],
  );
}

function ForkChanges({
  parent,
  draft,
}: {
  readonly parent: ExperimentView;
  readonly draft: Draft;
}) {
  const changes = experiment.forkChanges(parent.experiment, draft);
  if (changes.length === 0)
    return <p className="small muted">아직 원본과 같아요. 바꿀 조건을 골라 보세요.</p>;
  return (
    <div className="stack" style={{ gap: 6 }}>
      <ul className="list-plain small">
        {changes.map((c) => (
          <li key={c.field}>
            <b>{c.label}</b> <span className="diff-before">{c.before}</span> → {c.after}
          </li>
        ))}
      </ul>
      {experiment.leavesBenchmarkSet(changes) && (
        <Note tone="warn">
          과제가 바뀌어 원본과 다른 벤치마크 세트가 돼요. 순위표에서 원본과 나란히 비교되지 않아요.
        </Note>
      )}
    </div>
  );
}

function RunLine({ draft }: { readonly draft: Draft }) {
  return (
    <p className="small">
      {draft.runs}회 실행. 툴 {draft.tools.length}개
      {draft.time.kind === "lockstep" ? ", 결과가 재현돼요" : ", 벽시계 시간"}.
    </p>
  );
}

function Remaining({ items }: { readonly items: readonly string[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="list-plain small" aria-label="남은 것">
      {items.map((p) => (
        <li key={p} style={{ color: "var(--ink-2)" }}>
          {p}
        </li>
      ))}
    </ul>
  );
}

function QueueNote({
  queue,
}: {
  readonly queue?: { readonly running: number; readonly queued: number };
}) {
  if (!queue || (queue.running === 0 && queue.queued === 0)) return null;
  return (
    <p className="tiny muted">
      지금 {queue.running}회 실행 중, {queue.queued}회 대기. 사람마다 공평하게 차례가 돌아가요.
    </p>
  );
}

function SummaryCard({
  start,
  draft,
  onStart,
  busy,
}: {
  readonly start: Start;
  readonly draft: Draft;
  readonly onStart: () => void;
  readonly busy: boolean;
}) {
  const { meta } = useApp();
  const agents = meta?.harnesses.find((h) => h.id === draft.harnessId)?.agents.map((a) => a.id);
  const problems = experiment.draftProblems(draft, agents);
  const metaBad = Object.keys(metaProblems(draft.metadata)).length > 0;
  const all = [
    ...problems.what,
    ...problems.who,
    ...problems.how,
    ...(metaBad ? ["메타데이터의 이름과 값을 고쳐 주세요"] : []),
  ];
  const queue = meta?.queue;
  // A fork that changes nothing would only repeat the original, so it waits for a change.
  const same =
    start.parent !== undefined &&
    experiment.forkChanges(start.parent.experiment, draft).length === 0;
  return (
    <aside className="summary-card stack" aria-label="실행할 것">
      <h2 style={{ fontSize: 18 }}>{start.parent ? "원본에서 바꾼 것" : "실행할 것"}</h2>
      {start.parent && <ForkChanges parent={start.parent} draft={draft} />}
      {!start.parent && <RunLine draft={draft} />}
      <Remaining items={all} />
      <Button
        kind="primary"
        icon="play"
        busy={busy}
        disabled={!experiment.isReady(problems) || metaBad || same}
        why={all[0] ?? "원본과 같은 조건이에요. 바꿀 조건을 골라 주세요"}
        onClick={onStart}
      >
        {start.parent ? "조건 바꿔 다시 돌리기" : "실험 시작"}
      </Button>
      <QueueNote queue={queue} />
    </aside>
  );
}

function Wizard({ start }: { readonly start: Start }) {
  const { api, navigate, meta } = useApp();
  const [draft, setDraft] = useState<Draft>(start.draft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => {
    // A new draft's harness defaults to the first one that answers.
    if (draft.harnessId || !meta) return;
    const h = meta.harnesses.find((x) => x.status === "ok");
    if (h)
      setDraft((d) => ({
        ...d,
        harnessId: h.id,
        ...(h.agents[0] ? { agentId: h.agents[0].id } : {}),
      }));
  }, [meta, draft.harnessId]);
  const set = useCallback((change: Partial<Draft>) => setDraft((d) => ({ ...d, ...change })), []);
  const agents = meta?.harnesses.find((h) => h.id === draft.harnessId)?.agents;
  const problems = experiment.draftProblems(
    draft,
    agents?.map((a) => a.id),
  );
  const placeholder = experiment.suggestedName(
    undefined,
    agents?.find((a) => a.id === draft.agentId)?.name,
  );
  const launch = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const view = start.parent
        ? await api.call("forkExperiment", {
            params: { id: start.parent.experiment.id },
            body: experiment.toForkRequest(start.parent.experiment, draft),
          })
        : await api.call("createExperiment", { body: experiment.toRequest(draft, placeholder) });
      navigate({ name: "experiment", id: view.experiment.id });
    } catch (err) {
      setError(messageOf(err));
      setBusy(false);
    }
  };
  return (
    <div className="wizard">
      <div className="stack" style={{ gap: 28 }}>
        <WhatStep draft={draft} set={set} problems={problems.what} worlds={start.worlds} />
        <WhoStep draft={draft} set={set} problems={problems.who} />
        <HowStep draft={draft} set={set} problems={problems.how} />
        <NameStep draft={draft} set={set} placeholder={placeholder} />
      </div>
      <div className="stack">
        <SummaryCard start={start} draft={draft} onStart={() => void launch()} busy={busy} />
        {error && <Note tone="bad">{error}</Note>}
      </div>
    </div>
  );
}

function Lede({ forkOf, parent }: { readonly forkOf?: string; readonly parent?: ExperimentView }) {
  if (forkOf && parent)
    return (
      <>
        <Go to={{ name: "experiment", id: forkOf }}>{parent.experiment.name}</Go>의 조건을 그대로
        가져왔어요. 바꾸고 싶은 것만 바꾸세요.
      </>
    );
  return (
    <>
      세계와 시나리오, 하네스와 에이전트, 쓸 툴을 정해 주세요. 정하는 대로 오른쪽에 무엇이 돌지
      보여요.
    </>
  );
}

function StartBody({ start, formKey }: { readonly start: Start; readonly formKey: string }) {
  if (start.worlds.length === 0)
    return (
      <Note tone="warn">
        세계가 없어요. <Go to={{ name: "worlds" }}>세계를 먼저 만들어 주세요</Go>.
      </Note>
    );
  return <Wizard key={formKey} start={start} />;
}

export function NewExperimentPage() {
  const { page } = useApp();
  const query = page.name === "newExperiment" ? page : undefined;
  const forkOf = query?.forkOf;
  const scenarioId = query?.scenarioId;
  const start = useStart(forkOf, scenarioId);
  return (
    <div className="page">
      <PageHead
        title={forkOf ? "조건 바꿔 다시 돌리기" : "새 실험"}
        lede={
          <Lede
            {...(forkOf ? { forkOf } : {})}
            {...(start.data?.parent ? { parent: start.data.parent } : {})}
          />
        }
      />
      {start.error && <Failure error={start.error} retry={start.reload} />}
      {!start.data && !start.error && <Loading lines={5} />}
      {start.data && (
        <StartBody start={start.data} formKey={`${forkOf ?? ""}${scenarioId ?? ""}`} />
      )}
    </div>
  );
}
