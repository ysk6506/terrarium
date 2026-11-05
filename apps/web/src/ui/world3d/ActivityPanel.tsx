/**
 * Who is working in this world, as a list (REQ-050): the agent and model, the harness and experiment,
 * what it just did and to what. A click takes the camera to the equipment the run is at.
 */
import type { BlueprintIndex } from "@terrarium/core/world";
import { type ActivityState, doingOf, isIdle, nameOf } from "../../logic";

export function ActivityPanel({
  activity,
  index,
  now,
  onPick,
}: {
  readonly activity: ActivityState;
  readonly index: BlueprintIndex;
  readonly now: number;
  readonly onPick: (runId: string) => void;
}) {
  const workers = [...activity.workers].sort((a, b) => b.lastAt - a.lastAt);
  if (workers.length === 0) return null;
  return (
    <details className="run-panel" open>
      <summary>지금 일하는 에이전트 {workers.length}</summary>
      <ul>
        {workers.map((w) => {
          const name = nameOf(w.who);
          const target = w.at ? index.find(w.at)?.name : undefined;
          return (
            <li key={w.runId} style={{ ["--run" as string]: `var(--run-${w.hue})` }}>
              <button type="button" onClick={() => onPick(w.runId)} disabled={!w.at}>
                <span className="run-dot" aria-hidden="true" />
                <span className="run-text">
                  <strong>{name.title}</strong>
                  <small>{name.detail}</small>
                  <span className={isIdle(w, now) ? "run-doing run-idle" : "run-doing"}>
                    {doingOf(w)}
                    {target ? ` · ${target}` : ""}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </details>
  );
}
