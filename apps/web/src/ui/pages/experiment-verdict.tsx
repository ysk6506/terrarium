/**
 * 잘했나 (REQ-037, REQ-118, ADR-0171): the first answer of a result. One sentence of how many runs passed, one line
 * of the average with its interval, one quiet line, and beside them a picture: a dot for each finished run on a
 * 0–100 line with the pass line dashed. A passed run is a filled circle, a failed one a hollow square.
 */
import type { ExperimentView, RunSummary } from "@terrarium/core/contract";
import type { CSSProperties } from "react";
import { resultDots as dots, resultWords as words } from "../../logic";
import { MossAsk } from "../../moss";

/** Taller piles get smaller dots, so a pile of forty still fits the picture. */
const dotSize = (tallest: number): number => (tallest <= 9 ? 16 : 10);

/** Dots at most this high make one column; more wrap into a second beside it. */
const COLUMN_ROWS = 16;

const percentOf = (points: number): string => `${Math.min(100, Math.max(0, points))}%`;

function Plot({ runs }: { readonly runs: readonly RunSummary[] }) {
  const stacks = dots.dotStacks(runs);
  const counts = dots.dotCounts(stacks);
  const size = dotSize(dots.tallest(stacks));
  const rows = Math.min(Math.max(dots.tallest(stacks), 4), COLUMN_ROWS);
  const style = { "--dot": `${size}px`, "--rows": rows } as CSSProperties;
  return (
    <div className="res-plot" style={style}>
      <div className="res-plot-area" role="img" aria-label={dots.plotLabel(runs, stacks)}>
        <div className="res-plot-track">
          <span className="res-pass-line" style={{ left: percentOf(dots.PASS_LINE) }} />
          <span className="res-pass-label" style={{ left: percentOf(dots.PASS_LINE) }}>
            합격선 {dots.PASS_LINE}점
          </span>
          {stacks.map((s) => (
            <span key={s.at} className="res-stack" style={{ left: percentOf(s.at) }}>
              {s.dots.map((d) => (
                <span key={d.runId} className="res-dot" data-kind={d.kind} />
              ))}
            </span>
          ))}
        </div>
      </div>
      <div className="res-axis" aria-hidden="true">
        <span>0점</span>
        <span>50</span>
        <span>100점</span>
      </div>
      <ul className="res-legend">
        {dots.legendItems(counts).map((item) => (
          <li key={item.text} className="res-legend-item">
            {item.kind !== "note" && <span className="res-dot res-dot-key" data-kind={item.kind} />}
            {item.text}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Verdict({
  view,
  runs,
  status,
}: {
  readonly view: ExperimentView;
  readonly runs: readonly RunSummary[];
  readonly status: ExperimentView["status"];
}) {
  const a = view.analysis;
  const done = words.finishedRuns(runs);
  const passed = done.filter((r) => r.passed).length;
  const headline = words.passLine(done.length, passed, a.progress.failed);
  const quiet = words.quietLine(a);
  const pending = words.pendingLine(a.progress, status);
  return (
    <section className="res-card res-verdict" aria-label="잘했나">
      <div className="res-verdict-text">
        <h2 className="res-headline">{headline}</h2>
        {done.length > 0 && (
          <p className="res-line">
            <MossAsk question="평균 점수와 오차는 어떻게 구해요?">
              {words.scoreLine(a.score)}
            </MossAsk>
          </p>
        )}
        {words.errorNote(a.score) && <p className="res-quiet">{words.errorNote(a.score)}</p>}
        {quiet && <p className="res-quiet">{quiet}</p>}
        {pending && <p className="res-quiet">{pending}</p>}
      </div>
      {done.length > 0 && <Plot runs={runs} />}
    </section>
  );
}
