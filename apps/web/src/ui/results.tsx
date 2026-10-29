/**
 * Pieces every result view shares (REQ-037): the timeline of what happened, and small charts of a
 * metric over simulated time. Used by the scenario dry run and the run page.
 */
import { metricLabel } from "@terrarium/core/analysis";
import type { MetricSeries, TimelineEntry } from "@terrarium/core/session";
import type { BlueprintIndex } from "@terrarium/core/world";
import { lineChart, scoreBar, simTime } from "../logic";

const SOURCE_LABELS: Readonly<Record<TimelineEntry["source"], string>> = {
  scenario: "시나리오",
  alarm: "알람",
  agent: "에이전트",
};

export function Timeline({
  entries,
  limit = 200,
}: {
  readonly entries: readonly TimelineEntry[];
  readonly limit?: number;
}) {
  if (entries.length === 0) return <p className="muted small">기록된 일이 없다.</p>;
  const shown = entries.slice(0, limit);
  return (
    <>
      <ol className="timeline">
        {shown.map((entry, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: entries are an ordered log without ids
          <li key={i} className="timeline-item">
            <span className="timeline-t">{simTime(entry.t)}</span>
            <span
              className="timeline-dot"
              data-source={entry.source}
              data-severity={entry.severity}
              title={SOURCE_LABELS[entry.source]}
            />
            <span>
              <span className="sr-only">{SOURCE_LABELS[entry.source]}: </span>
              {entry.text}
            </span>
          </li>
        ))}
      </ol>
      {entries.length > limit && (
        <p className="tiny muted">앞의 {limit}건만 보인다. 전체는 보고서에 있다.</p>
      )}
    </>
  );
}

const BOX = { w: 280, h: 90 };

export function MetricChart({
  series,
  title,
}: {
  readonly series: MetricSeries;
  readonly title: string;
}) {
  const chart = lineChart(series.points, BOX);
  const last = series.points.at(-1)?.[1];
  return (
    <figure className="chart-card">
      <h3>{title}</h3>
      <svg
        className="chart"
        viewBox={`-34 -6 ${BOX.w + 40} ${BOX.h + 24}`}
        role="img"
        aria-label={`${title}, 마지막 값 ${last?.toFixed(1) ?? "없음"}`}
      >
        {chart.yTicks.map((t) => (
          <g key={`y${t.value}`}>
            <line className="chart-grid" x1={0} x2={BOX.w} y1={t.y} y2={t.y} />
            <text className="chart-label" x={-6} y={t.y + 4} textAnchor="end">
              {t.value}
            </text>
          </g>
        ))}
        {chart.xTicks.map((t) => (
          <text
            key={`x${t.value}`}
            className="chart-label"
            x={t.x}
            y={BOX.h + 16}
            textAnchor="middle"
          >
            {Math.round(t.value / 60)}분
          </text>
        ))}
        <path className="chart-line" d={chart.path} />
      </svg>
    </figure>
  );
}

/** A grid of the series worth looking at: the ones that moved the most, first. */
export function SeriesGrid({
  series,
  index,
  limit = 6,
}: {
  readonly series: readonly MetricSeries[];
  readonly index?: BlueprintIndex;
  readonly limit?: number;
}) {
  const spread = (s: MetricSeries) => {
    const ys = s.points.map((p) => p[1]);
    return ys.length ? Math.max(...ys) - Math.min(...ys) : 0;
  };
  const shown = [...series].sort((a, b) => spread(b) - spread(a)).slice(0, limit);
  if (shown.length === 0) return <p className="muted small">기록된 지표가 없다.</p>;
  return (
    <div className="charts">
      {shown.map((s) => (
        <MetricChart
          key={`${s.entityId}:${s.metric}`}
          series={s}
          title={`${index?.find(s.entityId)?.name ?? s.entityId}, ${metricLabel(s.metric)}`}
        />
      ))}
    </div>
  );
}

/** A mean score with its 95% interval on a 0..100 line; the numbers are always printed beside it. */
export function ScoreBar({
  summary,
  width = 160,
}: {
  readonly summary: { readonly mean: number; readonly ci95: number; readonly n: number };
  readonly width?: number;
}) {
  const bar = scoreBar(summary.mean, summary.ci95, width);
  return (
    <span className="score-bar" style={{ width }} aria-hidden="true">
      <span className="score-bar-track" />
      <span
        className="score-bar-ci"
        style={{ left: bar.from, width: Math.max(2, bar.to - bar.from) }}
      />
      <span className="score-bar-mean" style={{ left: bar.x }} />
    </span>
  );
}

/** A share between 0 and 1 as a short filled bar with its percentage. */
export function RateBar({ rate }: { readonly rate: number }) {
  return (
    <span className="row" style={{ gap: 8, flexWrap: "nowrap" }}>
      <span className="meter" aria-hidden="true" style={{ width: 90 }}>
        <i style={{ width: `${Math.round(rate * 100)}%` }} />
      </span>
      <span className="num">{Math.round(rate * 100)}%</span>
    </span>
  );
}
