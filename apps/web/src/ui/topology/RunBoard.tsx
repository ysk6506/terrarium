/**
 * One run's board at one moment (REQ-078 step 2): the topology of the world as the run's events left it at `t`, with the
 * agent's pulse and speech bubble. The run page shows one; the side-by-side view shows two at the same `t`. The board
 * itself is the lazy bundle of the topology view.
 */
import { lazy, Suspense, useMemo, useState } from "react";
import { hallTopology } from "../../logic";
import { Loading } from "../kit";
import { type AgentLook, usePulse } from "./AgentBubble";
import { type RunData, replayCatalog } from "./useRunData";

const TopologyView = lazy(() => import("./TopologyView"));

export interface RunBoardProps {
  readonly data: RunData;
  /** Seconds into the run. */
  readonly t: number;
  readonly caption?: string;
}

export function RunBoard({ data, t, caption }: RunBoardProps) {
  const { index, record } = data;
  const [selected, setSelected] = useState<readonly string[]>([]);
  const moment = useMemo(
    () => hallTopology.momentAt(index, replayCatalog, record.events, record.origin, t),
    [index, record, t],
  );
  const last = moment.state.last;
  const active = usePulse(last?.seq);
  const look: AgentLook = {
    bubble: hallTopology.bubbleOf(
      last,
      record.who,
      record.origin,
      (id) => index.find(id)?.name ?? id,
    ),
    effect: last?.effect === "act" ? "write" : "read",
    active,
  };
  return (
    <Suspense fallback={<Loading />}>
      <TopologyView
        index={index}
        source={moment.source}
        ran
        selected={selected}
        onSelect={setSelected}
        start={[]}
        agent={look}
        {...(caption ? { caption } : {})}
      />
    </Suspense>
  );
}
