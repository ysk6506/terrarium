/**
 * Who is working in a world, live (REQ-050): follows the world's activity stream and keeps the runs at
 * work as state. Updates are gathered over a short beat so a burst of calls is one repaint, and a
 * clock ticks once a second while anyone is working so quiet runs can be shown as quiet.
 */
import { useEffect, useRef, useState } from "react";
import { type ActivityState, applyActivity, noActivity, parseActivity } from "../../logic";
import { useApp } from "../context";

const BEAT_MS = 250;

export function useActivity(worldId: string): { activity: ActivityState; now: number } {
  const { api } = useApp();
  const [activity, setActivity] = useState<ActivityState>(noActivity);
  const [now, setNow] = useState(() => performance.now());
  const latest = useRef<ActivityState>(noActivity);

  useEffect(() => {
    latest.current = noActivity;
    setActivity(noActivity);
    if (typeof EventSource === "undefined") return;
    const source = new EventSource(api.url("worldActivity", { id: worldId }));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const flush = () => {
      timer = undefined;
      setActivity(latest.current);
    };
    const onMessage = (e: MessageEvent<string>) => {
      const event = parseActivity(e.data);
      if (!event) return;
      latest.current = applyActivity(latest.current, event, performance.now());
      timer ??= setTimeout(flush, BEAT_MS);
    };
    // After a reconnect the server tells again who is working, so what was known is let go first.
    const onOpen = () => {
      latest.current = noActivity;
      flush();
    };
    source.addEventListener("open", onOpen);
    for (const type of ["start", "call", "end"])
      source.addEventListener(type, onMessage as EventListener);
    return () => {
      if (timer) clearTimeout(timer);
      source.close();
    };
  }, [api, worldId]);

  const working = activity.workers.length > 0;
  useEffect(() => {
    if (!working) return;
    const tick = setInterval(() => setNow(performance.now()), 1000);
    return () => clearInterval(tick);
  }, [working]);

  return { activity, now };
}
