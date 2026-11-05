/** A short animation of one number, drawn frame by frame (and not at all for people who ask for less motion). */
import type { Engine } from "./engine";

const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

export function tween(
  engine: Engine,
  from: number,
  to: number,
  ms: number,
  apply: (value: number) => void,
): () => void {
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (ms <= 0 || reduced || from === to) {
    apply(to);
    engine.invalidate();
    return () => {};
  }
  let t = 0;
  const end = engine.animate();
  const off = engine.onFrame((dt) => {
    t = Math.min(1, t + (dt * 1000) / ms);
    apply(from + (to - from) * ease(t));
    if (t >= 1) stop();
  });
  const stop = () => {
    off();
    end();
  };
  return stop;
}
