/**
 * A store that counts the writes that can change what people earn or how popular a world is (REQ-101, ADR-0122). Titles and
 * popularity are worked out from records; the count tells them when what they remember is stale. It changes nothing
 * else: every call goes to the real store as it was.
 */
import { type ExperimentStore, isTerminal, type RunRecord } from "@terrarium/core/experiments";

/** Writes that change a fact a title or a score is made of. */
const CHANGING = new Set([
  "putWorld",
  "deleteWorld",
  "putScenario",
  "deleteScenario",
  "putExperiment",
  "putLike",
  "deleteLike",
  "putCalibrationMark",
]);

export interface WatchedStore {
  readonly store: ExperimentStore;
  /** Goes up whenever something that matters was written. */
  version(): number;
}

type Call = (...args: unknown[]) => Promise<unknown>;

export function watchStore(inner: ExperimentStore): WatchedStore {
  let version = 0;
  const store = new Proxy(inner, {
    get(target, prop) {
      const value: unknown = Reflect.get(target, prop, target);
      if (typeof value !== "function") return value;
      const call = (value as Call).bind(target);
      if (prop === "putRun")
        return async (run: RunRecord) => {
          await call(run);
          // a run that is still going changes nothing anyone earns
          if (isTerminal(run.status)) version += 1;
        };
      if (typeof prop === "string" && CHANGING.has(prop))
        return async (...args: unknown[]) => {
          const result = await call(...args);
          version += 1;
          return result;
        };
      return call;
    },
  });
  return { store, version: () => version };
}
