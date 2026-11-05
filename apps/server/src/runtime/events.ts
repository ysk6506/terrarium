/** Live updates per experiment and per world (REQ-030, REQ-050): the HTTP layer turns these into server-sent events. */
import type { ActivityEvent, ActivityWho, ExperimentEvent } from "@terrarium/core/contract";

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
