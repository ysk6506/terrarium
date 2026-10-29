/** Live updates per experiment (REQ-030): the HTTP layer turns these into server-sent events. */
import type { ExperimentEvent } from "@terrarium/core/contract";

type Listener = (event: ExperimentEvent) => void;

export class EventBus {
  private readonly listeners = new Map<string, Set<Listener>>();

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

  /** Experiments someone is watching right now. */
  get watched(): number {
    return this.listeners.size;
  }
}
