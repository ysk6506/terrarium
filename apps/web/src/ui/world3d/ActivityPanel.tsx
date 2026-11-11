/**
 * Who is working in this world (REQ-050, REQ-111): one quiet line, "에이전트 5개가 일하는 중", that opens a list above it. Agents
 * that look the same are one line with a count. A press on a line takes the camera to the equipment the run is at.
 * The chip sits above the "다음" button of the builder and below the moss pill, so nothing covers anything.
 */
import type { BlueprintIndex } from "@terrarium/core/world";
import { type ActivityState, groupWorkers, workersLine } from "../../logic";

export function ActivityPanel({
  activity,
  index,
  now,
  onPick,
  readOnly,
}: {
  readonly activity: ActivityState;
  readonly index: BlueprintIndex;
  readonly now: number;
  readonly onPick: (runId: string) => void;
  /** A stage without the builder's bar and chips (the home page's showcase). */
  readonly readOnly?: boolean | undefined;
}) {
  if (activity.workers.length === 0) return null;
  const groups = groupWorkers(activity.workers, now, (id) => index.find(id)?.name);
  return (
    <details className={`run-panel${readOnly ? " low" : ""}`}>
      <summary data-moss-skip="에이전트 목록을 접고 펴는 보기 조작">
        {workersLine(activity.workers.length)}
      </summary>
      <ul>
        {groups.map((g) => (
          <li key={g.key} style={{ ["--run" as string]: `var(--run-${g.hue})` }}>
            <button
              type="button"
              data-moss-skip="카메라를 옮기는 보기 조작"
              onClick={() => g.pick && onPick(g.pick)}
              disabled={!g.pick}
            >
              <span className="run-dot" aria-hidden="true" />
              <span className="run-text">
                <strong>
                  {g.title}
                  {g.count > 1 && <span className="run-count"> ×{g.count}</span>}
                </strong>
                <small>{g.detail}</small>
                <span className={g.idle ? "run-doing run-idle" : "run-doing"}>
                  {g.doing}
                  {g.target ? ` · ${g.target}` : ""}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}
