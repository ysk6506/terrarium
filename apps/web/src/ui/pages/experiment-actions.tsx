/**
 * What a person does to an experiment from its page (REQ-030, REQ-038, REQ-040): stop it, share a link to it, add
 * more runs, and lay two runs side by side. Runs are counted with "번" and situations with "개" (ADR-0171).
 */

import type { ExperimentView, RunSummary } from "@terrarium/core/contract";
import { repeatsOf, sizeProblemsOf } from "@terrarium/core/experiments";
import { useState } from "react";
import { hallTopology } from "../../logic";
import { useMossActions } from "../../moss";
import { useAction, useApp } from "../context";
import { Button, Dialog, NumberField } from "../kit";
import { CompareRuns } from "../topology/RunReplay";

/** 공유: one press makes a link anyone can open without signing in, and copies it. */
export function ShareButton({ view }: { readonly view: ExperimentView }) {
  const { api, toast } = useApp();
  const { busy, run } = useAction();
  const share = async () => {
    const made = await run(
      () => api.call("createShare", { params: { id: view.experiment.id }, body: {} }),
      undefined,
    );
    if (!made) return;
    try {
      await navigator.clipboard.writeText(made.url);
      toast("링크를 복사했어요. 받은 사람은 로그인 없이 보고서를 볼 수 있어요");
    } catch {
      toast("복사하지 못했어요. 브라우저가 클립보드를 막고 있어요", "bad");
    }
  };
  return (
    <Button
      icon="share"
      busy={busy}
      data-moss-skip="공유 링크는 누가 열 수 있는지 사람이 정해요"
      onClick={() => void share()}
    >
      공유
    </Button>
  );
}

export function CancelButton({
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
              {remaining}번 멈추기
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

export function AddRuns({
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
      <div style={{ width: 160 }}>
        <NumberField
          label="더 돌릴 상황 수"
          value={count}
          min={1}
          max={20}
          step={1}
          unit="개"
          onChange={(v) => v !== undefined && setCount(Math.round(v))}
        />
      </div>
      <Button
        data-moss-skip="세부 조절"
        busy={busy}
        disabled={seedsWhy !== undefined}
        why={seedsWhy}
        onClick={() => void more({ count }, `상황 ${count}개를 더했어요`)}
      >
        같은 조건으로 상황 {count}개 더 돌리기
        {repeats > 1 ? ` (실행 ${count * repeats}번)` : ""}
      </Button>
      <Button
        data-moss-skip="세부 조절"
        busy={busy}
        disabled={repeatsWhy !== undefined}
        why={repeatsWhy}
        onClick={() => void more({ repeats: 1 }, "상황마다 한 번씩 더했어요")}
      >
        {`상황마다 한 번씩 더 돌리기 (실행 ${seeds}번)`}
      </Button>
    </div>
  );
}

/** Two ticked runs and the button that lays them side by side. */
export function SideBySide({
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
