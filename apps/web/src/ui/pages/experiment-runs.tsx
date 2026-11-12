/**
 * 실행 (REQ-030, REQ-040, REQ-078, ADR-0171): each run of the experiment with its score, live while they go; the way to
 * run more; and, under them, what was tested and where the experiment came from.
 */
import type { ExperimentView, RunSummary } from "@terrarium/core/contract";
import { useState } from "react";
import type { LiveState } from "../../logic";
import { Empty, Section } from "../kit";
import { AddRuns, SideBySide } from "./experiment-actions";
import { ConditionsPanel, EndReasons, Lineage, RunsTable } from "./experiment-parts";
import { SubjectPanel } from "./experiment-subject";

export function RunsTab({
  view,
  runs,
  live,
  onChange,
}: {
  readonly view: ExperimentView;
  readonly runs: readonly RunSummary[];
  readonly live: LiveState | undefined;
  readonly onChange: (v: ExperimentView) => void;
}) {
  const [picked, setPicked] = useState<readonly string[]>([]);
  const pick = (runId: string) =>
    setPicked((p) => (p.includes(runId) ? p.filter((x) => x !== runId) : [...p, runId].slice(-2)));
  return (
    <>
      <Section title="실행" aside=<EndReasons analysis={view.analysis} />>
        {runs.length === 0 ? (
          <Empty title="아직 실행이 없어요" />
        ) : (
          <RunsTable
            runs={runs}
            live={live}
            analysis={view.analysis}
            picked={picked}
            onPick={pick}
          />
        )}
        {runs.length > 1 && (
          <SideBySide
            runs={runs}
            worldId={view.experiment.recipe.worldId}
            picked={picked}
            onPicked={setPicked}
          />
        )}
        <div style={{ marginTop: 16 }}>
          <AddRuns view={view} onDone={onChange} />
        </div>
      </Section>
      <SubjectPanel experiment={view.experiment} />
      <ConditionsPanel view={view} />
      <Lineage view={view} />
    </>
  );
}
