/**
 * The world versions the control plane has read lately (ADR-0056). A run opens its session on the exact
 * version the experiment recorded; reading and parsing a big blueprint takes tens to hundreds of
 * milliseconds on the thread that also serves HTTP, so hundreds of runs of a few worlds read each version
 * once. Concurrent reads of one version share one read.
 */
import type { Blueprint } from "@terrarium/core/world";

/** What the control plane keeps, counted in entities (a campus of 40,000 entities is about 100 MB parsed). */
export const DEFAULT_BLUEPRINT_ENTITIES = 120_000;

export class BlueprintCache {
  private readonly entries = new Map<string, Blueprint>();
  private readonly reading = new Map<string, Promise<Blueprint | undefined>>();
  private weight = 0;

  constructor(private readonly maxEntities = DEFAULT_BLUEPRINT_ENTITIES) {}

  get size(): number {
    return this.entries.size;
  }

  async get(
    key: string,
    load: () => Promise<Blueprint | undefined>,
  ): Promise<Blueprint | undefined> {
    const known = this.entries.get(key);
    if (known) {
      this.entries.delete(key);
      this.entries.set(key, known);
      return known;
    }
    let read = this.reading.get(key);
    if (!read) {
      read = load()
        .then((found) => {
          if (found) this.keep(key, found);
          return found;
        })
        .finally(() => this.reading.delete(key));
      this.reading.set(key, read);
    }
    return read;
  }

  private keep(key: string, blueprint: Blueprint): void {
    this.entries.set(key, blueprint);
    this.weight += blueprint.entities.length;
    for (const [oldKey, old] of this.entries) {
      if (this.weight <= this.maxEntities || this.entries.size <= 1) break;
      if (oldKey === key) continue;
      this.entries.delete(oldKey);
      this.weight -= old.entities.length;
    }
  }
}
