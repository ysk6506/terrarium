/**
 * The time bar of the builder's "시운전" (REQ-072, REQ-078): the same bar the runs have, over the frames of the
 * preview run. The 3D airflow map and the topology view both show the frame this bar is on, so there is one bar for
 * one moment, not one for each eye.
 */
import { useState } from "react";
import { hallTopology } from "../../logic";
import { ReplayBar } from "./ReplayBar";
import { useClock } from "./useClock";

export interface FramesBarProps {
  readonly frames: readonly { readonly t: number }[];
  /** The index of the frame shown. */
  readonly at: number;
  readonly onAt: (index: number) => void;
}

export function FramesBar({ frames, at, onAt }: FramesBarProps) {
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(hallTopology.DEFAULT_SPEED);
  const duration = frames[frames.length - 1]?.t ?? 0;
  const t = frames[at]?.t ?? 0;
  // Between two frames the clock runs on its own position; the frame follows it.
  const [between, setBetween] = useState(t);
  const onT = (next: number) => {
    setBetween(next);
    onAt(hallTopology.nearestFrame(frames, next));
  };
  const onPlaying = (play: boolean) => {
    if (play) setBetween(t >= duration ? 0 : t);
    setPlaying(play);
  };
  useClock({ playing, t: between, duration, speed, onT, onPlaying: setPlaying });
  if (frames.length < 2) return null;
  const step = (frames[1]?.t ?? 0) - (frames[0]?.t ?? 0);
  return (
    <ReplayBar
      t={t}
      duration={duration}
      playing={playing}
      onPlaying={onPlaying}
      onT={onT}
      speed={speed}
      onSpeed={setSpeed}
      step={step > 0 ? step : hallTopology.KEY_STEP_S}
    />
  );
}
