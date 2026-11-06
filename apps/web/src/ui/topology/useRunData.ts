/**
 * What the replay of one run is made of (REQ-078 step 2, REQ-083): its recorded events, the world as it was when it ran,
 * and, while it is still going, the activity stream of that world, which says when a new call has come. The events are
 * fetched again after each call (a burst of calls is one fetch), so the board shows faults and alarms as they come.
 */
import { Catalog } from "@terrarium/core/catalog";
import type { RunEventsView } from "@terrarium/core/contract";
import { BlueprintIndex } from "@terrarium/core/world";
import { useEffect, useMemo, useRef } from "react";
import { parseActivity } from "../../logic";
import { useApp, useAsync } from "../context";

export const replayCatalog = new Catalog();
const BEAT_MS = 300;

export interface RunData {
  readonly index: BlueprintIndex;
  readonly record: RunEventsView;
}

export interface RunDataState {
  readonly data: RunData | undefined;
  readonly error: Error | undefined;
}

/** Calls the run makes while the page is open; `onEnd` is told when the stream says the run is over. */
function useCallBeat(
  worldId: string,
  runId: string,
  live: boolean,
  reload: () => void,
  onEnd?: () => void,
): void {
  const { api } = useApp();
  const latest = useRef({ reload, onEnd });
  latest.current = { reload, onEnd };
  useEffect(() => {
    if (!live || typeof EventSource === "undefined") return;
    const source = new EventSource(api.url("worldActivity", { id: worldId }));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onMessage = (e: MessageEvent<string>) => {
      const event = parseActivity(e.data);
      if (!event || event.runId !== runId) return;
      if (event.type === "end") latest.current.onEnd?.();
      timer ??= setTimeout(() => {
        timer = undefined;
        latest.current.reload();
      }, BEAT_MS);
    };
    for (const type of ["call", "end"]) source.addEventListener(type, onMessage as EventListener);
    return () => {
      if (timer) clearTimeout(timer);
      source.close();
    };
  }, [api, worldId, runId, live]);
}

export function useRunData(
  runId: string,
  worldId: string,
  live: boolean,
  onEnd?: () => void,
): RunDataState {
  const { api } = useApp();
  const events = useAsync(
    (signal) => api.call("runEvents", { params: { id: runId }, signal }),
    [runId],
  );
  const world = useAsync(
    (signal) => api.call("runWorld", { params: { id: runId }, signal }),
    [runId],
  );
  useCallBeat(worldId, runId, live, events.reload, onEnd);
  const index = useMemo(
    () => (world.data ? new BlueprintIndex(world.data.blueprint) : undefined),
    [world.data],
  );
  const error = events.error ?? world.error;
  const data = index && events.data ? { index, record: events.data } : undefined;
  return { data, error };
}
