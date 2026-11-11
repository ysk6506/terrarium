/**
 * 어디서 점수를 잃었나 (REQ-037, ADR-0171): the scoring criteria as bars, the one that lost the most first. A track is
 * as long as the criterion's points and the filled part is what the runs earned of it on average.
 */
import type { ExperimentAnalysis } from "@terrarium/core/analysis";
import { resultLoss as loss } from "../../logic";
import { MossAsk } from "../../moss";

function Row({ row, done }: { readonly row: loss.LossRow; readonly done: number }) {
  return (
    <li className="res-bar-row">
      <span className="res-bar-label">{row.label}</span>
      <span className="res-bar-cell">
        {row.penalty ? (
          <span className="res-bar-note">감점 항목이에요</span>
        ) : (
          <>
            <span className="res-track" style={{ width: `${row.track * 100}%` }} aria-hidden="true">
              <span className="res-fill" style={{ width: `${row.fill * 100}%` }} />
            </span>
            {row.missedAll && done > 0 && (
              <span className="res-bar-note">{done}번 모두 점수를 받지 못했어요</span>
            )}
          </>
        )}
      </span>
      <span className="res-bar-num">{row.text}</span>
    </li>
  );
}

export function LossCard({ analysis }: { readonly analysis: ExperimentAnalysis }) {
  const rows = loss.lossRows(analysis.criteria);
  if (rows.length === 0) return null;
  const done = analysis.progress.completed;
  return (
    <section className="res-card" aria-label="어디서 점수를 잃었나">
      <div className="res-card-head">
        <h2>
          <MossAsk question="채점 항목은 어떻게 점수를 매겨요?">어디서 점수를 잃었나</MossAsk>
        </h2>
        <p className="res-sentence">{loss.lossSentence(rows, done)}</p>
      </div>
      <ul className="res-bars" aria-label="채점 항목별 받은 점수">
        {rows.map((r) => (
          <Row key={r.id} row={r} done={done} />
        ))}
      </ul>
      <p className="res-quiet">
        막대의 길이는 그 항목의 배점이에요. 파란 부분이 {done}번의 평균으로 받은 점수예요.
      </p>
    </section>
  );
}
