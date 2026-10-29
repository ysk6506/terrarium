/**
 * Live progress of an experiment over server-sent events (REQ-030). Run updates and tool calls arrive
 * as they happen; when a run finishes the full view is fetched again (debounced) for its analysis.
 */
import type { ExperimentView } from "@terrarium/core/contract";
import { useEffect, useRef, useState } from "react";
import { applyEvent, initialLive, type LiveState, parseEvent } from "../../logic";
import { useApp } from "../context";

const FINISHED = new Set(["completed", "failed", "cancelled"]);

export function useLive(
  view: ExperimentView | undefined,
  reload: () => void,
): LiveState | undefined {
  const { api } = useApp();
  const [live, setLive] = useState<LiveState>();
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  const id = view?.experiment.id;
  const done = view ? FINISHED.has(view.status) : true;

  useEffect(() => {
    if (view) setLive(initialLive(view.runs, view));
  }, [view]);

  useEffect(() => {
    if (!id || done || typeof EventSource === "undefined") return;
    const source = new EventSource(api.url("experimentEvents", { id }));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onMessage = (e: MessageEvent<string>) => {
      const event = parseEvent(`data: ${e.data}`);
      if (!event) return;
      setLive((state) => {
        const next = applyEvent(state ?? initialLive([]), event);
        if (next.stale && !timer)
          timer = setTimeout(() => {
            timer = undefined;
            reloadRef.current();
          }, 800);
        return { ...next, stale: false };
      });
    };
    for (const type of ["experiment", "run", "call"])
      source.addEventListener(type, onMessage as EventListener);
    return () => {
      if (timer) clearTimeout(timer);
      source.close();
    };
  }, [api, id, done]);

  return live;
}
