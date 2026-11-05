/**
 * The scheduler loop (REQ-032, ADR-0024): queued runs wait in the fair scheduler; whenever a run
 * arrives or finishes, as many start as the limits allow. Cancelling a queued run just removes it;
 * cancelling a running one stops its agent. A restarted server picks up where it left off.
 */
import {
  applyRunEvent,
  type Experiment,
  type ExperimentStore,
  FairScheduler,
  type QueuedRun,
  type RunRecord,
  type SchedulerLimits,
} from "@terrarium/core/experiments";
import type { StopReason } from "./executor";
import type { Stamps } from "./ids";

export type Execute = (
  run: RunRecord,
  experiment: Experiment,
  signal: AbortSignal,
  stopReason: () => StopReason | undefined,
) => Promise<RunRecord>;

interface Running {
  readonly queued: QueuedRun;
  readonly controller: AbortController;
  reason: StopReason | undefined;
  done: Promise<unknown>;
}

export class Dispatcher {
  private readonly scheduler: FairScheduler;
  private readonly running = new Map<string, Running>();
  private readonly waiting = new Map<string, { run: RunRecord; experiment: Experiment }>();
  private stopped = false;

  constructor(
    private readonly store: ExperimentStore,
    private readonly execute: Execute,
    private readonly stamps: Stamps,
    readonly limits: SchedulerLimits,
    private readonly onChange: (experimentId: string) => void = () => {},
  ) {
    this.scheduler = new FairScheduler(limits);
  }

  get counts(): { readonly running: number; readonly queued: number } {
    return { running: this.running.size, queued: this.scheduler.size };
  }

  enqueue(run: RunRecord, experiment: Experiment): void {
    this.waiting.set(run.id, { run, experiment });
    this.scheduler.enqueue({
      runId: run.id,
      user: experiment.owner,
      harnessId: experiment.recipe.harnessId,
    });
    this.pump();
  }

  /** 1-based place in line, for queued runs. */
  positionOf(runId: string): number | undefined {
    return this.scheduler.positionOf(
      runId,
      [...this.running.values()].map((r) => r.queued),
    );
  }

  isRunning(runId: string): boolean {
    return this.running.has(runId);
  }

  /** Stop a run wherever it is. Returns whether there was anything to stop. */
  async cancel(runId: string): Promise<boolean> {
    const live = this.running.get(runId);
    if (live) {
      live.reason ??= "cancelled";
      live.controller.abort();
      await live.done;
      return true;
    }
    const waiting = this.waiting.get(runId);
    if (!waiting || !this.scheduler.remove(runId)) return false;
    this.waiting.delete(runId);
    const stored = (await this.store.getRun(runId)) ?? waiting.run;
    await this.store.putRun(applyRunEvent(stored, { type: "cancel", at: this.stamps.now() }));
    this.onChange(waiting.experiment.id);
    return true;
  }

  /** Capacity changed (a node joined): start whatever now fits. */
  wake(): void {
    this.pump();
  }

  private pump(): void {
    if (this.stopped) return;
    for (const next of this.scheduler.take([...this.running.values()].map((r) => r.queued))) {
      const entry = this.waiting.get(next.runId);
      this.waiting.delete(next.runId);
      if (entry) this.start(next, entry.run, entry.experiment);
    }
  }

  private start(queued: QueuedRun, run: RunRecord, experiment: Experiment): void {
    const entry: Running = {
      queued,
      controller: new AbortController(),
      reason: undefined,
      done: Promise.resolve(),
    };
    this.running.set(run.id, entry);
    entry.done = this.execute(run, experiment, entry.controller.signal, () => entry.reason)
      .catch(() => undefined)
      .finally(() => {
        this.running.delete(run.id);
        this.onChange(experiment.id);
        this.pump();
      });
  }

  /** After a restart: runs that were mid-flight failed; queued ones get back in line. */
  async recover(): Promise<{ readonly resumed: number; readonly interrupted: number }> {
    let resumed = 0;
    let interrupted = 0;
    for (const run of await this.store.listActiveRuns()) {
      const experiment = await this.store.getExperiment(run.experimentId);
      if (run.status === "running" || !experiment) {
        await this.store.putRun(
          applyRunEvent(run, {
            type: "fail",
            at: this.stamps.now(),
            error: "서버가 다시 시작되어 실행이 중단됐어요",
          }),
        );
        interrupted++;
        continue;
      }
      this.enqueue(run, experiment);
      resumed++;
    }
    return { resumed, interrupted };
  }

  /** Stop taking runs and stop the ones going; they end as failed ("the server stopped"). */
  async shutdown(): Promise<void> {
    this.stopped = true;
    const live = [...this.running.values()];
    for (const r of live) {
      r.reason ??= "shutdown";
      r.controller.abort();
    }
    await Promise.all(live.map((r) => r.done));
  }
}
