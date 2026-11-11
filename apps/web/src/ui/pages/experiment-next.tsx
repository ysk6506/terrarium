/**
 * 다음에 해 볼 것 (ADR-0171): at most three suggestions, each there only when its condition holds. The first one is
 * drawn as the main one when it is about trusting the score; every one is a link to a screen that already exists.
 */
import type { ExperimentView, RunSummary } from "@terrarium/core/contract";
import { resultNext as next, seedRows } from "../../logic";
import { Go } from "../context";

export function NextCard({
  view,
  runs,
}: {
  readonly view: ExperimentView;
  readonly runs: readonly RunSummary[];
}) {
  const found = next.suggestions({
    experimentId: view.experiment.id,
    situations: view.experiment.recipe.seeds.length,
    score: view.analysis.score,
    rows: seedRows(runs),
    operation: view.experiment.recipe.operation !== undefined,
  });
  if (found.length === 0) return null;
  return (
    <aside className="res-card res-next" aria-label="다음에 해 볼 것">
      <h2>다음에 해 볼 것</h2>
      <ul className="res-suggestions">
        {found.map((s, i) => (
          <li key={s.id}>
            <Go
              to={s.to}
              className="res-suggestion"
              data-first={i === 0 ? "yes" : undefined}
              data-moss-skip="다음에 해 볼 것으로 가는 링크"
            >
              <span className="res-suggestion-title">{s.title}</span>
              <span className="res-suggestion-why">{s.why}</span>
            </Go>
          </li>
        ))}
      </ul>
    </aside>
  );
}
