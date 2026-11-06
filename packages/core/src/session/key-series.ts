/** The series a result charts (REQ-007): the answer, what the agent acted on, and what raised alarms. */
import type { ScenarioDoc, ToolCallRecord } from "@terrarium/core/scenario";
import type { World } from "@terrarium/core/world";
import { type MetricRecorder, type MetricSeries, RECORDED_METRICS } from "./recorder";

const MAX_SERIES = 24;

export interface SeriesSource {
  readonly world: World;
  readonly recorder: MetricRecorder;
  readonly scenario: ScenarioDoc;
  readonly calls: readonly ToolCallRecord[];
  readonly scenarioStart: number;
}

/** Entities worth charting. */
function keyEntities(s: SeriesSource): Set<string> {
  const answers = s.scenario.expectations.flatMap((e) =>
    e.kind === "diagnosis" ? e.rootCause : [],
  );
  const touched = s.calls.flatMap((c) => (c.effects ?? []).map((e) => e.target));
  const alarmed = s.world
    .events()
    .flatMap((e) => (e.type === "alarm.raise" && e.t >= s.scenarioStart ? [e.alarm.entityId] : []));
  return new Set([...answers, ...touched, ...alarmed]);
}

/** Their recorded series since the scenario started, at most MAX_SERIES. */
export function keySeries(s: SeriesSource): MetricSeries[] {
  const pairs = [...keyEntities(s)].flatMap((id) => {
    const kind = s.world.index.find(id)?.kind;
    return (kind ? (RECORDED_METRICS[kind] ?? []) : []).map((metric) => [id, metric] as const);
  });
  return pairs.slice(0, MAX_SERIES).map(([entityId, metric]) => ({
    entityId,
    metric,
    points: s.recorder.series(entityId, metric, s.scenarioStart),
  }));
}
