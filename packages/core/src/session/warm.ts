/**
 * Warm starts (REQ-032, ADR-0033). Opening a session spends most of its time warming the world up
 * (600 simulated seconds of physics) and that warm-up depends only on the blueprint and the recorder
 * options, not on the scenario, the seed or the agent. So the first session of a world pays for it,
 * keeps the warmed state here, and later sessions of the same world start from a copy: the same bytes
 * the warm-up would have produced, in a tenth of the time or less.
 */
import type { WorldCheckpoint } from "@terrarium/core/world";
import type { RecorderCapture } from "./recorder";

export interface WarmStart {
  readonly world: WorldCheckpoint;
  readonly recorder: RecorderCapture;
}

/** A small least-recently-used store; one per worker thread (each thread has its own memory). */
export class WarmStartCache {
  private readonly entries = new Map<string, WarmStart>();
  private hitCount = 0;
  private missCount = 0;

  constructor(readonly maxEntries = 4) {}

  get(key: string): WarmStart | undefined {
    const found = this.entries.get(key);
    if (!found) {
      this.missCount++;
      return undefined;
    }
    this.hitCount++;
    this.entries.delete(key);
    this.entries.set(key, found);
    return found;
  }

  put(key: string, warm: WarmStart): void {
    this.entries.delete(key);
    this.entries.set(key, warm);
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value as string;
      this.entries.delete(oldest);
    }
  }

  get size(): number {
    return this.entries.size;
  }

  get hits(): number {
    return this.hitCount;
  }

  get misses(): number {
    return this.missCount;
  }
}
