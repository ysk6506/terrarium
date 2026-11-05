/**
 * How much memory a thread may spend on sessions, and whether one more fits (ADR-0056). A session costs
 * what its world's size says, and a world costs once per thread that holds it, so the control plane can
 * tell without asking the thread. Counting sessions alone lets a few huge worlds run a machine out of
 * memory long before the session limit; counting megabytes does not.
 */
import { totalmem } from "node:os";
import { DEFAULT_CACHED_ENTITIES } from "./world-cache";

/** Memory one session adds on its thread, MB: its own state and recorder (measured 4 MB at 4,040 entities, 6.5 MB at 10,224, with margin). */
export const sessionMb = (entities: number): number => 0.5 + entities * 0.001;

/** Memory a thread spends holding a world once, MB: the blueprint, its index and plans, and the warm start (measured 4 to 7 KB per entity, rounded to the low side because sessions share most of it). */
export const worldMb = (entities: number): number => entities * 0.004;

/** The part of a thread's memory sessions may be promised; the rest is room for garbage not yet collected. */
export const PROMISED_SHARE = 0.7;

/** What the main thread, HTTP, the database and the runtime use, MB. */
const MAIN_THREAD_MB = 800;

/** What a thread may use when nobody said: this machine's (or container's) memory, less the main thread, shared out. */
export function defaultThreadMb(threads: number): number {
  const constrained = process.constrainedMemory?.() ?? 0;
  const total = totalmem();
  const limit = constrained > 0 && constrained < total ? constrained : total;
  const mb = ((limit / 1048576 - MAIN_THREAD_MB) * 0.85) / Math.max(1, threads);
  return Math.max(512, Math.floor(mb));
}

interface Held {
  readonly world: string;
  readonly mb: number;
}

/** What one thread holds: its sessions, and the worlds it was sent (the oldest are dropped past the cache limit, as the thread drops them). */
export class Ledger {
  private readonly sessions = new Map<string, Held>();
  private readonly worlds = new Map<string, number>();

  constructor(
    /** Memory this thread may promise to sessions and worlds, MB. */
    readonly promisedMb: number,
    private readonly cachedEntities = DEFAULT_CACHED_ENTITIES,
  ) {}

  get count(): number {
    return this.sessions.size;
  }

  has(world: string): boolean {
    return this.worlds.has(world);
  }

  /** Memory promised on this thread, MB. */
  get usedMb(): number {
    let mb = 0;
    for (const held of this.sessions.values()) mb += held.mb;
    for (const entities of this.worlds.values()) mb += worldMb(entities);
    return mb;
  }

  /** What one more session of this world would add, MB. */
  costOf(world: string, entities: number): number {
    return sessionMb(entities) + (this.worlds.has(world) ? 0 : worldMb(entities));
  }

  /** Whether one more fits. A thread with nothing on it takes any session, however large: it would run nowhere else either. */
  fits(world: string, entities: number): boolean {
    if (this.sessions.size === 0) return true;
    return this.usedMb + this.costOf(world, entities) <= this.promisedMb;
  }

  /** Promise a session its memory; true when this thread did not hold the world yet (it must be sent the blueprint). */
  add(id: string, world: string, entities: number): boolean {
    const fresh = !this.worlds.has(world);
    this.sessions.set(id, { world, mb: sessionMb(entities) });
    this.worlds.delete(world);
    this.worlds.set(world, entities);
    this.trim(world);
    return fresh;
  }

  remove(id: string): void {
    this.sessions.delete(id);
  }

  clear(): void {
    this.sessions.clear();
    this.worlds.clear();
  }

  /** The thread keeps only so many entities' worth of worlds; those with sessions on them are kept either way. */
  private trim(newest: string): void {
    const inUse = new Set([...this.sessions.values()].map((h) => h.world));
    let weight = 0;
    for (const entities of this.worlds.values()) weight += entities;
    for (const [key, entities] of this.worlds) {
      if (weight <= this.cachedEntities) return;
      if (key === newest || inUse.has(key)) continue;
      this.worlds.delete(key);
      weight -= entities;
    }
  }
}
