/**
 * The experiment platform, assembled: worlds, scenarios, experiments, results, the scheduler loop
 * and live events, over the adapters. The HTTP layer calls this and nothing below it.
 */
import { Catalog } from "@terrarium/core/catalog";
import type { HarnessView, MetaView } from "@terrarium/core/contract";
import {
  DEFAULT_LIMITS,
  type HarnessPort,
  MAX_SEEDS,
  type SchedulerLimits,
} from "@terrarium/core/experiments";
import type { Adapters } from "../adapters";
import type { PlatformContext, Viewer } from "./context";
import { Dispatcher } from "./dispatcher";
import { EventBus } from "./events";
import { executeRun, type ToolGateway } from "./executor";
import { Experiments, summarize } from "./experiments";
import type { SessionHost } from "./hosts";
import { type Stamps, SYSTEM_STAMPS } from "./ids";
import { Results } from "./results";
import { Scenarios } from "./scenarios";
import { Worlds } from "./worlds";

export interface PlatformOptions {
  readonly adapters: Pick<Adapters, "store" | "harnesses" | "sources" | "telemetry">;
  readonly host: SessionHost;
  readonly gateway?: ToolGateway;
  readonly limits?: Partial<SchedulerLimits>;
  /** Sessions the hosts can run at once, now. When given, it (not a fixed number) caps how many runs start. */
  readonly capacity?: () => number;
  readonly stamps?: Stamps;
  readonly version?: string;
  /** Wall-clock limit per agent run, and the grace after the session ends (tests shorten these). */
  readonly wallLimitMs?: number;
  readonly graceMs?: number;
}

const AGENTS_TTL_MS = 30_000;

/**
 * Limits that follow what the hosts can hold right now (ADR-0032). `maxRunning` is the smaller of the
 * configured cap, if any, and the capacity. A per-user or per-harness cap nobody configured is a share
 * of the capacity (a quarter and a half), so one person's experiment can use a big cluster while the
 * fair queue still lets others in. Read each time the scheduler looks: nodes joining or leaving change
 * how many runs start without restarting anything.
 */
export function withCapacity(
  limits: SchedulerLimits,
  configured: Partial<SchedulerLimits> | undefined,
  capacity: () => number,
): SchedulerLimits {
  const live = { ...limits };
  const share = (floor: number, divisor: number) => () =>
    Math.max(floor, Math.ceil(capacity() / divisor));
  const follow = (key: "maxRunning" | "perUser" | "perHarness", get: () => number) =>
    Object.defineProperty(live, key, { enumerable: true, get });
  follow("maxRunning", () =>
    Math.max(0, Math.min(configured?.maxRunning ?? Number.POSITIVE_INFINITY, capacity())),
  );
  if (configured?.perUser === undefined) follow("perUser", share(limits.perUser, 4));
  if (configured?.perHarness === undefined) follow("perHarness", share(limits.perHarness, 2));
  return live;
}

export class Platform {
  readonly worlds: Worlds;
  readonly scenarios: Scenarios;
  readonly experiments: Experiments;
  readonly results: Results;
  readonly events = new EventBus();
  readonly dispatcher: Dispatcher;
  private readonly ctx: PlatformContext;
  private readonly agentCache = new Map<string, { at: number; view: HarnessView }>();

  constructor(private readonly options: PlatformOptions) {
    const harnesses = new Map<string, HarnessPort>(
      options.adapters.harnesses.map((h) => [h.info.id, h]),
    );
    const stamps = options.stamps ?? SYSTEM_STAMPS;
    this.ctx = {
      store: options.adapters.store,
      catalog: new Catalog(),
      harnesses,
      sources: options.adapters.sources,
      ...(options.adapters.telemetry ? { telemetry: options.adapters.telemetry } : {}),
      host: options.host,
      stamps,
      events: this.events,
    };
    const deps = {
      store: this.ctx.store,
      harnesses,
      host: options.host,
      stamps,
      emit: (id: string, e: Parameters<EventBus["emit"]>[1]) => this.events.emit(id, e),
      ...(options.gateway ? { gateway: options.gateway } : {}),
      ...(options.wallLimitMs ? { wallLimitMs: options.wallLimitMs } : {}),
      ...(options.graceMs !== undefined ? { graceMs: options.graceMs } : {}),
    };
    this.dispatcher = new Dispatcher(
      this.ctx.store,
      (run, experiment, signal, reason) => executeRun(deps, run, experiment, signal, reason),
      stamps,
      options.capacity
        ? withCapacity({ ...DEFAULT_LIMITS, ...options.limits }, options.limits, options.capacity)
        : { ...DEFAULT_LIMITS, ...options.limits },
      (id) => void this.announce(id),
    );
    this.worlds = new Worlds(this.ctx);
    this.scenarios = new Scenarios(this.ctx);
    this.experiments = new Experiments(this.ctx, this.scenarios, this.dispatcher);
    this.results = new Results(this.ctx, this.experiments);
  }

  /** Tell watchers how an experiment stands now. */
  private async announce(experimentId: string): Promise<void> {
    if (this.events.watched === 0) return;
    const experiment = await this.ctx.store.getExperiment(experimentId);
    if (!experiment) return;
    const summary = summarize(experiment, await this.ctx.store.listRuns(experimentId));
    this.events.emit(experimentId, { type: "experiment", summary });
  }

  private async harnessView(h: HarnessPort): Promise<HarnessView> {
    const cached = this.agentCache.get(h.info.id);
    if (cached && Date.now() - cached.at < AGENTS_TTL_MS) return cached.view;
    let view: HarnessView;
    try {
      view = { ...h.info, agents: await h.agents(), status: "ok" };
    } catch (err) {
      view = { ...h.info, agents: [], status: "unreachable", error: (err as Error).message };
    }
    this.agentCache.set(h.info.id, { at: Date.now(), view });
    return view;
  }

  async meta(viewer: Viewer): Promise<MetaView> {
    return {
      version: this.options.version ?? "dev",
      user: { name: viewer.name, source: viewer.source },
      harnesses: await Promise.all(
        [...this.ctx.harnesses.values()].map((h) => this.harnessView(h)),
      ),
      sources: [...this.ctx.sources.values()].map((s) => s.view),
      telemetry: this.ctx.telemetry
        ? { configured: true, name: this.ctx.telemetry.name }
        : { configured: false, name: "ClickStack" },
      limits: { ...this.dispatcher.limits, maxSeeds: MAX_SEEDS },
      queue: this.dispatcher.counts,
    };
  }

  /** Pick up runs left from before a restart. */
  start(): Promise<{ readonly resumed: number; readonly interrupted: number }> {
    return this.dispatcher.recover();
  }

  async stop(): Promise<void> {
    await this.dispatcher.shutdown();
  }
}
