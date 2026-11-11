/**
 * 상황마다 (REQ-118, ADR-0171): rows are situations and columns the times each ran, every cell the score with 합격 or
 * 불합격 and a way into that run. A situation whose runs came out differently carries a tag. This is where a person
 * sees whether the score can be trusted.
 */
import type { ExperimentView, RunSummary } from "@terrarium/core/contract";
import type { SeedDot } from "../../logic";
import { seedRows, resultSituations as sit } from "../../logic";
import { Go } from "../context";

function Cell({
  dot,
  seed,
  linked,
}: {
  readonly dot: SeedDot | undefined;
  readonly seed: number;
  readonly linked: boolean;
}) {
  if (!dot) return <td className="res-cell-empty">—</td>;
  const inner = (
    <>
      <span className="sr-only">
        상황 {seed}의 {dot.repeat}번째 실행,{" "}
      </span>
      {sit.cellText(dot)}
    </>
  );
  return (
    <td>
      {linked ? (
        <Go
          to={{ name: "run", id: dot.runId }}
          className="res-cell"
          data-state={dot.state}
          data-moss-skip="실행 들여다보기 링크"
        >
          {inner}
        </Go>
      ) : (
        <span className="res-cell" data-state={dot.state}>
          {inner}
        </span>
      )}
    </td>
  );
}

export function SituationsCard({
  runs,
  view,
}: {
  readonly runs: readonly RunSummary[];
  readonly view: ExperimentView;
}) {
  const rows = seedRows(runs);
  if (rows.length === 0) return null;
  const a = view.analysis;
  const headers = sit.repeatHeaders(rows, a.repeats);
  const queued = new Set(runs.filter((r) => r.status === "queued").map((r) => r.id));
  const shake = a.repeats > 1 ? sit.shakeLine(a.withinSeed?.spread) : undefined;
  const source = a.repeats > 1 ? sit.sourceOfDifference(a.findings) : undefined;
  return (
    <section className="res-card res-situations" aria-label="상황마다">
      <div className="res-card-head">
        <h2>상황마다</h2>
        <p className="res-sentence">{sit.situationsSentence(rows, a.repeats)}</p>
      </div>
      <div className="res-scroll">
        <table className="res-table">
          <thead>
            <tr>
              <th scope="col">상황</th>
              {headers.map((h) => (
                <th key={h} scope="col">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const tag = sit.rowTag(row);
              return (
                <tr key={row.seed}>
                  <th scope="row">
                    <span className="res-seed">상황 {row.seed}</span>
                    {tag && (
                      <span className="res-tag" data-tag={tag === "갈렸어요" ? "split" : "stuck"}>
                        {tag}
                      </span>
                    )}
                  </th>
                  {headers.map((h, at) => {
                    const dot = sit.cellOf(row, at + 1);
                    return (
                      <Cell
                        key={h}
                        dot={dot}
                        seed={row.seed}
                        linked={dot !== undefined && !queued.has(dot.runId)}
                      />
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {shake && <p className="res-quiet">{shake}</p>}
      {source && <p className="res-quiet">{source}</p>}
      <p className="res-quiet">칸을 누르면 그 실행을 들여다봐요.</p>
    </section>
  );
}
