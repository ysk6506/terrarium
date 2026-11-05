/**
 * Worlds a thread keeps ready (ADR-0056). Opening a session on a world needs the blueprint checked and
 * indexed; that is the same work, and the same megabytes, for every run of the world. A thread does it
 * once per world and shares the result between its sessions, and the control plane sends the blueprint
 * to a thread only the first time (after that, a key says which world).
 */
import { Catalog } from "@terrarium/core/catalog";
import {
  type Blueprint,
  blueprintDigest,
  type PreparedWorld,
  prepareWorld,
} from "@terrarium/core/world";

/** Which world a session is made on: the store's id and digest of the version, which a host does not recompute. */
export interface WorldIdentity {
  readonly key: string;
  readonly digest: string;
}

/** Worlds counted in entities: the weight of a cached world, and what a thread may keep. */
export const DEFAULT_CACHED_ENTITIES = 150_000;

const digests = new WeakMap<Blueprint, string>();

/** The identity of a blueprint nobody named (tests, small deployments): its digest, worked out once per object. */
export function identityOf(blueprint: Blueprint): WorldIdentity {
  let digest = digests.get(blueprint);
  if (digest === undefined) {
    digest = blueprintDigest(blueprint);
    digests.set(blueprint, digest);
  }
  return { key: `${blueprint.id}@${digest}`, digest };
}

export class WorldCache {
  private readonly entries = new Map<string, PreparedWorld>();
  private weight = 0;

  constructor(private readonly maxEntities = DEFAULT_CACHED_ENTITIES) {}

  has(key: string): boolean {
    return this.entries.has(key);
  }

  get size(): number {
    return this.entries.size;
  }

  /** The prepared world, and now the most recently used. */
  get(key: string): PreparedWorld | undefined {
    const found = this.entries.get(key);
    if (found) {
      this.entries.delete(key);
      this.entries.set(key, found);
    }
    return found;
  }

  /** Check and index a blueprint and keep it (the oldest worlds make room; sessions already using one keep it alive). */
  prepare(identity: WorldIdentity, blueprint: Blueprint): PreparedWorld {
    const prepared = prepareWorld(blueprint, new Catalog(), identity.digest);
    this.entries.set(identity.key, prepared);
    this.weight += blueprint.entities.length;
    for (const [key, old] of this.entries) {
      if (this.weight <= this.maxEntities || this.entries.size <= 1) break;
      if (key === identity.key) continue;
      this.entries.delete(key);
      this.weight -= old.blueprint.entities.length;
    }
    return prepared;
  }
}
