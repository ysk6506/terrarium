/**
 * 요약 (REQ-037, ADR-0171): the first screen of a result answers three questions in order: did it do well, where did
 * it lose points, and can the score be trusted (the situations). A fork's comparison with its original comes right
 * after the verdict. An operation has no score, so it says what it has instead.
 */
import type { ExperimentView, RunSummary } from "@terrarium/core/contract";
import { Go } from "../context";
import { LossCard } from "./experiment-loss";
import { NextCard } from "./experiment-next";
import { ParentCard } from "./experiment-parts";
import { SituationsCard } from "./experiment-situations";
import { Verdict } from "./experiment-verdict";

function OperationSummary({ view }: { readonly view: ExperimentView }) {
  return (
    <section className="res-card" aria-label="운영 실험">
      <div className="res-card-head">
        <h2>운영 실험이에요</h2>
        <p className="res-sentence">
          실행마다 결과 화면에서 서비스 가용률, 놓친 알람, 탐지 지연을 봐요. 합격이나 점수는 없어요.
        </p>
      </div>
      <p>
        <Go
          to={{ name: "experiment", id: view.experiment.id, tab: "runs" }}
          data-moss-skip="실행 탭으로 가는 링크"
        >
          실행 {view.runs.length}번 보기
        </Go>
      </p>
    </section>
  );
}

export function SummaryTab({
  view,
  runs,
  status,
}: {
  readonly view: ExperimentView;
  readonly runs: readonly RunSummary[];
  readonly status: ExperimentView["status"];
}) {
  const operation = view.experiment.recipe.operation !== undefined;
  return (
    <div className="res-flow">
      {operation ? (
        <OperationSummary view={view} />
      ) : (
        <Verdict view={view} runs={runs} status={status} />
      )}
      {view.analysis.parent && (
        <ParentCard parent={view.analysis.parent} ready={view.analysis.progress.completed > 0} />
      )}
      {!operation && <LossCard analysis={view.analysis} />}
      <div className="res-pair">
        {!operation && <SituationsCard runs={runs} view={view} />}
        <NextCard view={view} runs={runs} />
      </div>
    </div>
  );
}
