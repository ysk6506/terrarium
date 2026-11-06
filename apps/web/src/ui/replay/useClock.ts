/**
 * The clock of the time bar (REQ-078 step 2): while it plays, the position moves by the world seconds that pass in the
 * real ones (`speed`), every 100 ms, until the end, where it stops. The position itself belongs to the caller.
 */
import { useEffect, useRef } from "react";
import { hallTopology } from "../../logic";

const TICK_MS = 100;

export interface ClockInput {
  readonly playing: boolean;
  readonly t: number;
  readonly duration: number;
  readonly speed: number;
  readonly onT: (t: number) => void;
  readonly onPlaying: (playing: boolean) => void;
}

export function useClock(input: ClockInput): void {
  const latest = useRef(input);
  latest.current = input;
  const { playing } = input;
  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    const timer = setInterval(() => {
      const now = performance.now();
      const { t, duration, speed, onT, onPlaying } = latest.current;
      const next = hallTopology.advance(t, now - last, speed, duration);
      last = now;
      onT(next.t);
      if (next.done) onPlaying(false);
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [playing]);
}
