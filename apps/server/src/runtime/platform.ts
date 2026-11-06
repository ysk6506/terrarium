/**
 * The experiment platform, assembled: worlds, scenarios, experiments, results, the scheduler loop
 * and live events, over the adapters. The HTTP layer calls this and nothing below it.
 */
import { Catalog } from "@terrarium/core/catalog";
import type { ConnectionView, HarnessView, MetaView } from "@terrarium/core/contract";
import { DEFAULT_LIMITS, MAX_SEEDS, type SchedulerLimits } from "@terrarium/core/experiments";
import { type Adapters, adapterOfPort, SecretBox } from "../adapters";
import { AgentVersions } from "./agent-versions";
import { BlueprintCache } from "./blueprint-cache";
import type { TryOptions } from "./connection-try";
import { Connections } from "./connections";
import type { PlatformContext, Viewer } from "./context";
import { Dispatcher } from "./dispatcher";
import { Escalations } from "./escalations";
import { EventBus, RunLogs } from "./events";
import { executeRun, type ToolGateway } from "./executor";
import { Experiments, summarize } from "./experiments";
import type { SessionHost } from "./hosts";
import { type Stamps, SYSTEM_STAMPS } from "./ids";
import { Results } from "./results";
import { Scenarios } from "./scenarios";
import { Worlds } from "./worlds";

export interface PlatformOptions {
  readonly adapters: Pick<Adapters, "store" | "harnesses" | "sources" | "telemetry"> &
    Partial<
      Pick<
        Adapters,
        | "harnessConfigs"
        | "connect"
        | "allowedHosts"
        | "secretBox"
        | "retention"
        | "telemetryDefault"
      >
    >;
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
  /** How long to wait for a harness to list its agents, ms (tests shorten this). */
  readonly agentsTimeoutMs?: number;
  /** How "말 걸어 보기" waits (tests shorten this). */
  readonly tryOptions?: TryOptions;
}

/** What the meta and the experiment form need of a connection: who it is and which agents it has. */
function harnessViewOf(v: ConnectionView): HarnessView {
  return {
    id: v.id,
    name: v.name,
    kind: v.kind,
    description: v.description,
    toolTransport: v.toolTransport,
    // a connection with a fixed tool address is registered once; the new-experiment screen says so (feedback 14)
    ...(v.mcpSlotUrl ? { mcpSlot: v.id } : {}),
    telemetry: v.telemetry,
    ...(v.wakeable ? { wakeable: true } : {}),
    agents: v.agents,
    status: v.status,
    ...(v.error === undefined ? {} : { error: v.error }),
  };
}

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

/** The connections: the config file's harnesses plus the ones people registered. */
function connectionsOf(options: PlatformOptions, stamps: Stamps): Connections {
  const { adapters } = options;
  const configs = new Map((adapters.harnessConfigs ?? []).map((c) => [c.id, c]));
  // The server's own telemetry, as the adapter a connection that says "default" reads from.
  const defaultTelemetry =
    adapters.telemetryDefault ??
    (adapters.telemetry
      ? adapterOfPort(adapters.telemetry.port, adapters.telemetry.name)
      : undefined);
  return new Connections({
    store: adapters.store,
    stamps,
    fixed: adapters.harnesses.map((port) => {
      const config = configs.get(port.info.id);
      return config ? { port, config } : { port };
    }),
    connect: adapters.connect ?? { env: process.env, fetch },
    // Without a key on disk, sealed values live only as long as this process (tests, running without a disk).
    box: adapters.secretBox ?? SecretBox.ephemeral(),
    ...(adapters.retention ? { retention: adapters.retention } : {}),
    ...(adapters.allowedHosts ? { allowedHosts: adapters.allowedHosts } : {}),
    ...(options.agentsTimeoutMs ? { agentsTimeoutMs: options.agentsTimeoutMs } : {}),
    ...(options.tryOptions ? { tryOptions: options.tryOptions } : {}),
    ...(defaultTelemetry ? { defaultTelemetry } : {}),
    ...(options.gateway?.slotUrl
      ? { slotUrl: (s: string) => options.gateway?.slotUrl?.(s) ?? "" }
      : {}),
  });
}

export class Platform {
  readonly worlds: Worlds;
  readonly scenarios: Scenarios;
  readonly experiments: Experiments;
  readonly results: Results;
  readonly events = new EventBus();
  readonly logs = new RunLogs();
  /** Runs that wait for a person to answer their `ask_human` (ADR-0087 item 4). */
  readonly escalations = new Escalations();
  readonly dispatcher: Dispatcher;
  readonly connections: Connections;
  readonly agentVersions: AgentVersions;
  private readonly ctx: PlatformContext;

  constructor(private readonly options: PlatformOptions) {
    const stamps = options.stamps ?? SYSTEM_STAMPS;
    const harnesses = connectionsOf(options, stamps);
    this.connections = harnesses;
    this.ctx = {
      store: options.adapters.store,
      catalog: new Catalog(),
      harnesses,
      sources: options.adapters.sources,
      ...(options.adapters.telemetry ? { telemetry: options.adapters.telemetry } : {}),
      host: options.host,
      stamps,
      events: this.events,
      logs: this.logs,
    };
    const deps = {
      store: this.ctx.store,
      blueprints: new BlueprintCache(),
      harnesses,
      host: options.host,
      stamps,
      logs: this.logs,
      escalations: this.escalations,
      emit: (id: string, e: Parameters<EventBus["emit"]>[1]) => this.events.emit(id, e),
      activity: (worldId: string, e: Parameters<EventBus["emitWorld"]>[1]) =>
        this.events.emitWorld(worldId, e),
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
    this.agentVersions = new AgentVersions(this.ctx);
    this.experiments = new Experiments(
      this.ctx,
      this.scenarios,
      this.dispatcher,
      this.agentVersions,
    );
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

  async meta(viewer: Viewer): Promise<MetaView> {
    return {
      version: this.options.version ?? "dev",
      user: { name: viewer.name, source: viewer.source },
      harnesses: (await this.connections.views()).map(harnessViewOf),
      sources: [...this.ctx.sources.values()].map((s) => s.view),
      telemetry: this.ctx.telemetry
        ? { configured: true, name: this.ctx.telemetry.name }
        : { configured: false, name: "ClickStack" },
      limits: { ...this.dispatcher.limits, maxSeeds: MAX_SEEDS },
      queue: this.dispatcher.counts,
      expiring: await this.connections.expiring(viewer),
    };
  }

  /** Remove connections nobody has used for too long (REQ-051). Run when the server starts and then now and then. */
  sweepConnections(): Promise<string[]> {
    return this.connections.sweep();
  }

  /** Pick up runs left from before a restart. */
  async start(): Promise<{ readonly resumed: number; readonly interrupted: number }> {
    // Connections first: a run left from before is picked up on the harness it was started on.
    await this.connections.load();
    await this.connections.sweep();
    return this.dispatcher.recover();
  }

  async stop(): Promise<void> {
    await this.dispatcher.shutdown();
  }
}
