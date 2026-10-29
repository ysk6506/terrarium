import type { Stamps } from "../ids";

/** Predictable stamps for tests: p-1, p-2 … and a clock that ticks one second per call. */
export function sequentialStamps(start = Date.UTC(2026, 9, 29)): Stamps {
  let n = 0;
  let t = start;
  return {
    id: (prefix) => `${prefix}-${++n}`,
    now: () => {
      t += 1000;
      return new Date(t).toISOString();
    },
  };
}
