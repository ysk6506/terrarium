/**
 * The exam-paper check in the editor's side panel (REQ-070). Three agents that need no model play the saved scenario;
 * if one that knows nothing still scores well, or one that only says the answer gets full marks, the panel says so in
 * plain words, so the author fixes the paper before spending model calls on it.
 */
import type { BaselineRun } from "@terrarium/core/session";
import { scenario } from "../../logic";
import { Button, Note } from "../kit";
import type { ScenarioEditor } from "./useScenario";

function score(total: number | null): string {
  return total === null ? "점수 없음" : `${total}점`;
}

function Row({ run }: { readonly run: BaselineRun }) {
  return (
    <li className="baseline">
      <div>
        <b>{run.label}</b>
        <div className="tiny muted">{run.what}</div>
      </div>
      <div className="baseline-score" title={run.passed ? "합격선을 넘었어요" : "합격선 아래예요"}>
        <b>{score(run.total)}</b>
        <span className="tiny muted">{run.passed ? "합격" : "불합격"}</span>
      </div>
    </li>
  );
}

export function Calibration({
  e,
  openSheet,
}: {
  readonly e: ScenarioEditor;
  readonly openSheet: () => void;
}) {
  const { checked } = e.calibration;
  const stale = checked !== undefined && checked.digest !== e.record.digest;
  const view = checked?.view;
  // an agent that only knows the answer gets full marks: the paper asks for no action at all
  const asksNoAction = (view?.runs.find((r) => r.id === "knows")?.total ?? 0) >= 100;
  const addAction = () => {
    e.change((d) => scenario.suggestedAction(d, e.index).doc);
    openSheet();
  };
  return (
    <div className="builder-block stack">
      <h3 style={{ marginBottom: 0 }}>변별력 점검</h3>
      <p className="small muted">
        모델 없이 기준 에이전트 셋으로 점수를 재 봐요. 아무것도 몰라도 점수가 나오는 시험지는 좋은
        조합을 가려내지 못해요.
      </p>
      <Button
        busy={e.calibration.checking}
        disabled={!e.mine && e.dirty}
        why="다른 사람의 시나리오예요. 내 사본으로 저장한 뒤에 점검할 수 있어요"
        onClick={() => void e.calibration.check()}
      >
        {view ? "다시 점검" : "점검하기"}
      </Button>
      {view && view.runs.length === 0 && (
        <Note tone="warn">
          시나리오에 고칠 곳이 남아 있어서 점검하지 못했어요. 위의 고칠 곳을 먼저 고쳐 주세요.
        </Note>
      )}
      {view && view.runs.length > 0 && (
        <>
          {stale && <Note tone="warn">점검한 뒤에 시나리오가 바뀌었어요. 다시 점검해 주세요.</Note>}
          <ul className="baselines" aria-label="기준 에이전트의 점수">
            {view.runs.map((run) => (
              <Row key={run.id} run={run} />
            ))}
          </ul>
          {view.warnings.length === 0 ? (
            <Note tone="good">모르는 쪽과 아는 쪽의 점수가 확실히 갈려요.</Note>
          ) : (
            <>
              <ul className="issues" aria-label="점검 결과">
                {view.warnings.map((w) => (
                  <li key={w} className="issue issue-static">
                    <span className="issue-mark" />
                    <span>{w}</span>
                  </li>
                ))}
              </ul>
              <div className="row" style={{ gap: 8 }}>
                {asksNoAction && (
                  <Button size="small" icon="plus" onClick={addAction}>
                    조치 항목 더하기
                  </Button>
                )}
                <Button kind="quiet" size="small" onClick={openSheet}>
                  채점표 열기
                </Button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
