/** Live updates per experiment and per world (REQ-030, REQ-050): the HTTP layer turns these into server-sent events. */
import type { ActivityEvent, ActivityWho, ExperimentEvent } from "@terrarium/core/contract";
import { type CallStamp, stampReal } from "@terrarium/core/session";
import type { RunEvent } from "@terrarium/core/world";

type Listener = (event: ExperimentEvent) => void;
type ActivityListener = (event: ActivityEvent) => void;

export class EventBus {
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly worldListeners = new Map<string, Set<ActivityListener>>();
  /** Runs working right now, by world: what a viewer who arrives late is told first. */
  private readonly working = new Map<string, Map<string, ActivityWho>>();

  subscribe(experimentId: string, listener: Listener): () => void {
    const set = this.listeners.get(experimentId) ?? new Set();
    set.add(listener);
    this.listeners.set(experimentId, set);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.listeners.delete(experimentId);
    };
  }

  emit(experimentId: string, event: ExperimentEvent): void {
    for (const listener of this.listeners.get(experimentId) ?? []) {
      try {
        listener(event);
      } catch {
        // A broken subscriber must not stop the run or the others.
      }
    }
  }

  /** The runs working in a world now, as `start` events. */
  workingIn(worldId: string): ActivityEvent[] {
    return [...(this.working.get(worldId) ?? [])].map(([runId, who]) => ({
      type: "start",
      runId,
      who,
    }));
  }

  subscribeWorld(worldId: string, listener: ActivityListener): () => void {
    const set = this.worldListeners.get(worldId) ?? new Set();
    set.add(listener);
    this.worldListeners.set(worldId, set);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.worldListeners.delete(worldId);
    };
  }

  /** Something a run did in a world; kept so that a run's start is remembered until its end. */
  emitWorld(worldId: string, event: ActivityEvent): void {
    if (event.type === "start") {
      const runs = this.working.get(worldId) ?? new Map<string, ActivityWho>();
      runs.set(event.runId, event.who);
      this.working.set(worldId, runs);
    } else if (event.type === "end") {
      const runs = this.working.get(worldId);
      runs?.delete(event.runId);
      if (runs?.size === 0) this.working.delete(worldId);
    }
    for (const listener of this.worldListeners.get(worldId) ?? []) {
      try {
        listener(event);
      } catch {
        // A broken subscriber must not stop the run or the others.
      }
    }
  }

  /** Experiments someone is watching right now. */
  get watched(): number {
    return this.listeners.size;
  }
}

interface LiveRun {
  readonly events: RunEvent[];
  readonly calls: CallStamp[];
  readonly startedAt: string | undefined;
}

/**
 * The record of the runs that are going now (REQ-083): the events the session has written so far and the wall-clock
 * time each call was seen at. A finished run carries its record in its result, so this forgets a run when it ends.
 */
export class RunLogs {
  private readonly live = new Map<string, LiveRun>();

  open(runId: string, startedAt: string | undefined): void {
    this.live.set(runId, { events: [], calls: [], startedAt });
  }

  /** How many events of the run are held: what the session is asked to give after. */
  count(runId: string): number {
    return this.live.get(runId)?.events.length ?? 0;
  }

  /** The session wrote these events after the ones held; `call` is the call made, if one was. */
  record(runId: string, fresh: readonly RunEvent[], call?: CallStamp): void {
    const run = this.live.get(runId);
    if (!run) return;
    if (call) run.calls.push(call);
    run.events.push(...fresh);
  }

  /** The events so far with the wall clock on them, or nothing when the run is not going. */
  get(runId: string): RunEvent[] | undefined {
    const run = this.live.get(runId);
    return run && stampReal(run.events, run.calls, run.startedAt);
  }

  /** The calls seen, to stamp the finished record with. */
  callsOf(runId: string): readonly CallStamp[] {
    return this.live.get(runId)?.calls ?? [];
  }

  close(runId: string): void {
    this.live.delete(runId);
  }
}
