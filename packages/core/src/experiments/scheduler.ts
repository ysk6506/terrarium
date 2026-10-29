/**
 * Fair scheduling of runs (REQ-032). Many people queue many experiments; one person's hundred runs
 * must not starve another's one. Each time capacity frees up, the next run comes from the user with
 * the fewest runs going, ties broken by who was served longest ago, then first come first served
 * within that user. Limits apply to the whole host, to each user and to each harness (a harness may
 * only take so many agents at once).
 *
 * The policy is pure and deterministic; the server loop calls it whenever a run finishes or arrives.
 */

export interface QueuedRun {
  readonly runId: string;
  readonly user: string;
  readonly harnessId: string;
}

export interface SchedulerLimits {
  /** Runs at once on the host. Most of a run is waiting for the model, so this exceeds the CPU count. */
  readonly maxRunning: number;
  readonly perUser: number;
  readonly perHarness: number;
  /** Per-harness overrides of `perHarness`. */
  readonly harness?: Readonly<Record<string, number>>;
}

/**
 * Defaults for the reference host (8 vCPU, 64 GB). A run spends most of its time waiting for the
 * agent's model, so 4 runs per vCPU; capacity measurement (REQ-032) confirms or lowers this.
 */
export const DEFAULT_LIMITS: SchedulerLimits = { maxRunning: 32, perUser: 8, perHarness: 16 };

export class FairScheduler {
  private readonly queue: Array<QueuedRun & { seq: number }> = [];
  private readonly lastServed = new Map<string, number>();
  private seq = 0;
  private served = 0;

  constructor(private readonly limits: SchedulerLimits = DEFAULT_LIMITS) {}

  enqueue(run: QueuedRun): void {
    if (this.queue.some((q) => q.runId === run.runId)) return;
    this.queue.push({ ...run, seq: this.seq++ });
  }

  /** Remove a queued run (cancelled before it started). Returns whether it was queued. */
  remove(runId: string): boolean {
    const i = this.queue.findIndex((q) => q.runId === runId);
    if (i >= 0) this.queue.splice(i, 1);
    return i >= 0;
  }

  get size(): number {
    return this.queue.length;
  }

  /** 1-based place in the order runs would start now, for "대기 3번째" in the UI. */
  positionOf(runId: string, running: readonly QueuedRun[] = []): number | undefined {
    const order = this.order(running, Number.POSITIVE_INFINITY);
    const i = order.findIndex((q) => q.runId === runId);
    return i >= 0 ? i + 1 : undefined;
  }

  /** The runs to start now, given what is running; they leave the queue. */
  take(running: readonly QueuedRun[]): QueuedRun[] {
    const picked = this.order(running, this.limits.maxRunning - running.length);
    for (const run of picked) {
      this.remove(run.runId);
      this.lastServed.set(run.user, ++this.served);
    }
    return picked;
  }

  private harnessLimit(id: string): number {
    return this.limits.harness?.[id] ?? this.limits.perHarness;
  }

  /** Simulate picking runs one by one under the limits. */
  private order(running: readonly QueuedRun[], capacity: number): QueuedRun[] {
    const perUser = countBy(running, (r) => r.user);
    const perHarness = countBy(running, (r) => r.harnessId);
    const served = new Map(this.lastServed);
    const pending = [...this.queue];
    const out: QueuedRun[] = [];
    let tick = this.served;
    while (out.length < capacity) {
      const eligible = pending.filter(
        (q) =>
          (perUser.get(q.user) ?? 0) < this.limits.perUser &&
          (perHarness.get(q.harnessId) ?? 0) < this.harnessLimit(q.harnessId),
      );
      const next = pickFairest(eligible, perUser, served);
      if (!next) break;
      out.push({ runId: next.runId, user: next.user, harnessId: next.harnessId });
      pending.splice(pending.indexOf(next), 1);
      perUser.set(next.user, (perUser.get(next.user) ?? 0) + 1);
      perHarness.set(next.harnessId, (perHarness.get(next.harnessId) ?? 0) + 1);
      served.set(next.user, ++tick);
    }
    return out;
  }
}

function countBy<T>(items: readonly T[], key: (t: T) => string): Map<string, number> {
  const out = new Map<string, number>();
  for (const item of items) out.set(key(item), (out.get(key(item)) ?? 0) + 1);
  return out;
}

/** Fewest running first, then served longest ago, then oldest in the queue. */
function pickFairest<T extends QueuedRun & { seq: number }>(
  eligible: readonly T[],
  running: ReadonlyMap<string, number>,
  served: ReadonlyMap<string, number>,
): T | undefined {
  let best: T | undefined;
  for (const q of eligible) {
    if (!best) {
      best = q;
      continue;
    }
    const key = (x: T) => [running.get(x.user) ?? 0, served.get(x.user) ?? -1, x.seq] as const;
    const [a, b] = [key(q), key(best)];
    if (a[0] < b[0] || (a[0] === b[0] && (a[1] < b[1] || (a[1] === b[1] && a[2] < b[2])))) best = q;
  }
  return best;
}
