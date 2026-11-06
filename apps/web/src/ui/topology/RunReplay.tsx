/**
 * The replay of one run (REQ-078 step 2, ADR-0084 items 8 and 9): the first line of the result, the board, and the one
 * time bar. While the run goes, the bar follows the newest moment; drag it back and it stays where it is put.
 */
import {
  incidentSpans,
  isOperation,
  markers,
  operationMarks,
  storyLine,
} from "@terrarium/core/topology";
import { useMemo, useState } from "react";
import { hallTopology } from "../../logic";
import { Button, Note } from "../kit";
import { ReplayBar } from "../replay/ReplayBar";
import { useClock } from "../replay/useClock";
import { RunBoard } from "./RunBoard";
import { StoryLine } from "./StoryLine";
import { type RunData, replayCatalog, useRunData } from "./useRunData";

const W = hallTopology.TOPO_WORDS;

/** The position, whether it plays, and how fast; at the newest moment it follows a run that is still going. */
export function usePlayer(duration: number, live: boolean) {
  const [pos, setPos] = useState(0);
  const [free, setFree] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(hallTopology.DEFAULT_SPEED);
  const following = live && !free;
  const t = following ? duration : Math.min(pos, duration);
  const onT = (next: number) => {
    setPos(next);
    setFree(!live || next < duration - 0.5);
  };
  const onPlaying = (play: boolean) => {
    if (play) {
      setPos(t >= duration ? 0 : t);
      setFree(true);
    }
    setPlaying(play);
  };
  useClock({ playing, t, duration, speed, onT, onPlaying: setPlaying });
  return { t, onT, playing, onPlaying, speed, setSpeed, following };
}

export function useMarks(data: RunData | undefined) {
  return useMemo(() => {
    if (!data) return [];
    const { record } = data;
    const found = isOperation(record.events)
      ? operationMarks(record.events)
      : markers(record.events);
    return hallTopology.relative(found, record.origin);
  }, [data]);
}

/** An operation's incident bars; none for a run of one incident. */
export function useBars(data: RunData | undefined) {
  return useMemo(() => {
    if (!data || !isOperation(data.record.events)) return undefined;
    const { record } = data;
    return hallTopology.barsOf(
      incidentSpans(record.events),
      record.origin,
      record.end - record.origin,
    );
  }, [data]);
}

/** The first line of the result: "고장 1곳 → ... → 영향 범위 서버 108 → 0 · 9분 30초 · 툴 호출 11번". */
function useStory(data: RunData | undefined) {
  return useMemo(() => {
    // the first line counts one incident toward an answer; an operation has many incidents and no answer
    if (!data || data.record.live || isOperation(data.record.events)) return undefined;
    const { index, record } = data;
    const first = markers(record.events).find((m) => m.kind === "act")?.t;
    const servers = hallTopology.serversMoved(index, replayCatalog, record.events, first);
    return storyLine(record.events, { origin: record.origin, servers });
  }, [data]);
}

export interface RunReplayProps {
  readonly runId: string;
  readonly worldId: string;
  readonly live: boolean;
  readonly onEnd?: () => void;
}

export function RunReplay({ runId, worldId, live, onEnd }: RunReplayProps) {
  const { data, error } = useRunData(runId, worldId, live, onEnd);
  const duration = data ? data.record.end - data.record.origin : 0;
  const player = usePlayer(duration, data?.record.live ?? false);
  const marks = useMarks(data);
  const bars = useBars(data);
  const story = useStory(data);
  if (error && !data) return <Note tone="warn">{W.replayNone}</Note>;
  if (!data) return <p className="muted">{W.replayLoading}</p>;
  const hasWorld = data.record.events.some((e) => e.kind === "world");
  return (
    <section className="section replay" aria-label={W.replay}>
      {story && <StoryLine story={story} origin={data.record.origin} onT={player.onT} />}
      {!hasWorld && !data.record.live && <Note tone="warn">{W.replayOld}</Note>}
      <div className="replay-stage">
        <RunBoard data={data} t={player.t} />
      </div>
      <ReplayBar
        t={player.t}
        duration={duration}
        marks={marks}
        {...(bars ? { bars } : {})}
        playing={player.playing}
        onPlaying={player.onPlaying}
        onT={player.onT}
        speed={player.speed}
        onSpeed={player.setSpeed}
      />
      {player.following && <p className="tiny muted">{W.following}</p>}
    </section>
  );
}

export interface CompareProps {
  readonly worldId: string;
  /** Two runs of one scenario, left and right. */
  readonly runs: readonly [
    { readonly id: string; readonly index: number },
    { readonly id: string; readonly index: number },
  ];
  readonly onClose: () => void;
}

/** Two runs on one clock: the boards side by side at the same moment, with one bar (its marks are the left run's). */
export function CompareRuns({ worldId, runs, onClose }: CompareProps) {
  const left = useRunData(runs[0].id, worldId, false);
  const right = useRunData(runs[1].id, worldId, false);
  const span = (d: RunData | undefined) => (d ? d.record.end - d.record.origin : 0);
  const duration = Math.max(span(left.data), span(right.data));
  const player = usePlayer(duration, false);
  const marks = useMarks(left.data);
  if ((left.error && !left.data) || (right.error && !right.data))
    return <Note tone="warn">{W.replayNone}</Note>;
  if (!left.data || !right.data) return <p className="muted">{W.replayLoading}</p>;
  return (
    <section className="section replay" aria-label={W.sideBySide}>
      <div className="replay-pair">
        {[left.data, right.data].map((d, i) => (
          <div className="replay-stage" key={runs[i]?.id}>
            <RunBoard data={d} t={player.t} caption={`${(runs[i]?.index ?? 0) + 1}번째 실행`} />
          </div>
        ))}
      </div>
      <ReplayBar
        t={player.t}
        duration={duration}
        marks={marks}
        playing={player.playing}
        onPlaying={player.onPlaying}
        onT={player.onT}
        speed={player.speed}
        onSpeed={player.setSpeed}
      />
      <Button kind="plain" size="small" onClick={onClose}>
        {W.closeBySide}
      </Button>
    </section>
  );
}
