/**
 * One run of one experiment (REQ-001, REQ-007, REQ-014): a world, its physics, the scenario flow, the
 * selected tools and a metric recorder, all in simulated time. Hosts (a worker thread on the server,
 * a test) drive it:
 *
 *   start()            warm the world up and play the scenario until the agent's task begins
 *   call(tool, args)   one agent tool call; time then moves on per the time policy
 *   sync(elapsed)      realtime policy only: catch simulated time up with the wall clock
 *   finish(reason)     end the run, let the world settle briefly, score it, return the result
 *
 * The session never reads the wall clock itself, so the same seed and the same calls give the same
 * result (REQ-001).
 */
import { Catalog } from "@terrarium/core/catalog";
import { createFacades } from "@terrarium/core/facades";
import { ConflictError, InvalidValueError } from "@terrarium/core/kernel";
import {
  type EndReason,
  investigationCalls,
  ORACLE_VERSION,
  type Score,
  score,
} from "@terrarium/core/oracle";
import { DEFAULT_PHYSICS, Physics } from "@terrarium/core/physics";
import {
  type AgentTask,
  actionsOf,
  type Diagnosis,
  hasErrors,
  type ScenarioDoc,
  ScenarioRunner,
  scenarioDigest,
  type ToolCallRecord,
  validateScenario,
} from "@terrarium/core/scenario";
import {
  type Args,
  Toolbox,
  type ToolContext,
  type ToolResult,
  type ToolSpec,
} from "@terrarium/core/tools";
import { type Blueprint, blueprintDigest, World, type WorldEvent } from "@terrarium/core/world";
import { DEFAULT_RECORDER, MetricRecorder, type MetricSeries, RECORDED_METRICS } from "./recorder";
import { buildTimeline, type TimelineEntry } from "./timeline";

export type TimePolicy =
  /** Each tool call costs this many simulated seconds (default; deterministic). */
  | { readonly kind: "lockstep"; readonly secondsPerCall: number }
  /** Simulated time follows the wall clock × speed; the host calls sync(). */
  | { readonly kind: "realtime"; readonly speed: number };

export const DEFAULT_TIME: TimePolicy = { kind: "lockstep", secondsPerCall: 30 };

export interface SessionConfig {
  readonly blueprint: Blueprint;
  readonly scenario: ScenarioDoc;
  /** Tools the experiment selected; submit_diagnosis is always added (it is how the agent answers). */
  readonly tools: readonly string[];
  readonly seed: number;
  readonly catalog?: Catalog;
  readonly profiles?: { readonly vcenter?: string; readonly vrops?: string };
  readonly time?: TimePolicy;
  /** Simulated seconds of normal operation before the scenario starts (default 600). */
  readonly warmupSeconds?: number;
  /** Simulated seconds the world keeps running after the agent stops, before scoring (default 60). */
  readonly aftermathSeconds?: number;
  /** Longest the scenario may take to hand over the task (default 24 h). */
  readonly maxPreAgentSeconds?: number;
  readonly sampleSeconds?: number;
  readonly retentionSeconds?: number;
}

export type SessionStatus = "ready" | "running" | "ended";

export interface CallResult extends ToolResult {
  /** Simulated time the call was made. */
  readonly t: number;
  /** Set when this call ended the run. */
  readonly ended?: EndReason;
}

export interface RunResult {
  readonly score: Score;
  readonly endReason: EndReason;
  readonly task: AgentTask;
  readonly toolCalls: readonly ToolCallRecord[];
  readonly diagnosis?: Diagnosis;
  readonly diagnosedAt?: number;
  readonly timeline: readonly TimelineEntry[];
  readonly series: readonly MetricSeries[];
  readonly digests: { readonly world: string; readonly scenario: string; readonly oracle: string };
  readonly seed: number;
  readonly simTime: {
    readonly scenarioStart: number;
    readonly agentStart: number;
    readonly end: number;
  };
  readonly recorderBytes: number;
}

const ALWAYS_TOOLS = ["submit_diagnosis"];
const MAX_SERIES = 24;

/** World events the agent caused (tools and protocol facades), as opposed to scenario and physics. */
const byAgent = (e: WorldEvent) => e.cause !== "physics" && !e.cause.startsWith("scenario:");

export class Session {
  readonly world: World;
  private readonly physics: Physics;
  private readonly runner: ScenarioRunner;
  private readonly toolbox: Toolbox;
  private readonly recorder: MetricRecorder;
  private readonly ctx: ToolContext;
  private readonly time: TimePolicy;
  private readonly calls: ToolCallRecord[] = [];
  private state: SessionStatus = "ready";
  private task: AgentTask | undefined;
  private diagnosis: Diagnosis | undefined;
  private diagnosedAt: number | undefined;
  private scenarioStart = 0;
  private result: RunResult | undefined;

  private constructor(
    private readonly config: SessionConfig,
    world: World,
  ) {
    this.world = world;
    this.physics = new Physics(world);
    this.time = config.time ?? DEFAULT_TIME;
    this.toolbox = new Toolbox([...new Set([...config.tools, ...ALWAYS_TOOLS])]);
    this.recorder = new MetricRecorder(world, {
      sampleSeconds: config.sampleSeconds ?? DEFAULT_RECORDER.sampleSeconds,
      retentionSeconds: config.retentionSeconds ?? DEFAULT_RECORDER.retentionSeconds,
    });
    this.runner = new ScenarioRunner(config.scenario, world, config.seed, {
      toolCalls: () => this.calls,
      diagnosis: () => this.diagnosis,
    });
    this.ctx = {
      world,
      facades: createFacades(world, config.profiles),
      metrics: this.recorder,
      wait: (seconds) => this.advance(Math.min(seconds, this.remaining())),
      submit: (d) => {
        this.diagnosis = d;
        this.diagnosedAt = world.time();
      },
    };
  }

  /** Build a session; refuses an invalid blueprint or scenario with the reasons. */
  static create(config: SessionConfig): Session {
    const catalog = config.catalog ?? new Catalog();
    const world = World.fromBlueprint(config.blueprint, catalog);
    const issues = validateScenario(config.scenario, { index: world.index, catalog });
    if (hasErrors(issues)) {
      const reasons = issues.filter((i) => i.severity === "error").map((i) => i.message);
      throw new InvalidValueError(`시나리오를 실행할 수 없다: ${reasons.join("; ")}`);
    }
    return new Session(config, world);
  }

  get status(): SessionStatus {
    return this.state;
  }

  /** The tools the agent may call, with their JSON schemas (for harness adapters and MCP). */
  toolSpecs(): ToolSpec[] {
    return this.toolbox.list();
  }

  /** Warm up, then play the scenario until it hands the task to the agent. */
  start(): AgentTask {
    if (this.state !== "ready") throw new ConflictError("the session has already started");
    this.physics.settle();
    this.advance(this.config.warmupSeconds ?? 600);
    this.scenarioStart = this.world.time();
    this.runner.start();
    this.runner.tick();
    const deadline = this.world.time() + (this.config.maxPreAgentSeconds ?? 86_400);
    while (!this.runner.agentTask) {
      if (this.world.time() >= deadline)
        throw new InvalidValueError("the scenario did not hand the task to the agent in time");
      this.advance(DEFAULT_PHYSICS.stepSeconds);
    }
    this.task = this.runner.agentTask;
    this.state = "running";
    return this.task;
  }

  call(tool: string, args: Args = {}): CallResult {
    const t = this.world.time();
    if (this.state !== "running") {
      const why =
        this.state === "ready"
          ? "the run has not started"
          : `the run has ended (${this.result?.endReason})`;
      return { ok: false, t, error: why };
    }
    const task = this.task as AgentTask;
    if (tool !== "submit_diagnosis" && investigationCalls(this.calls) >= task.maxToolCalls) {
      this.end("tool_budget");
      return {
        ok: false,
        t,
        error: `the budget of ${task.maxToolCalls} tool calls is used up; the run has ended`,
        ended: "tool_budget",
      };
    }
    const before = this.world.lastSeq();
    const result = this.toolbox.call(tool, args, this.ctx);
    const effects = actionsOf(this.world.events(before).filter(byAgent));
    this.calls.push({
      t,
      tool,
      args,
      ok: result.ok,
      ...(result.error ? { error: result.error } : {}),
      effects,
    });
    if (tool === "submit_diagnosis" && result.ok) {
      this.end("diagnosed");
      return { ...result, t, ended: "diagnosed" };
    }
    if (this.time.kind === "lockstep" && tool !== "wait")
      this.advance(Math.min(this.time.secondsPerCall, this.remaining()));
    if (this.remaining() <= 0) {
      this.end("time_limit");
      return { ...result, t, ended: "time_limit" };
    }
    return { ...result, t };
  }

  /** Realtime policy: move simulated time to `elapsedSeconds` of wall clock after the task began. */
  sync(elapsedSeconds: number): EndReason | undefined {
    if (this.state !== "running" || this.time.kind !== "realtime") return undefined;
    const target = (this.task as AgentTask).startedAt + elapsedSeconds * this.time.speed;
    const behind = target - this.world.time();
    if (behind > 0) this.advance(Math.min(behind, this.remaining()));
    if (this.remaining() > 0) return undefined;
    this.end("time_limit");
    return "time_limit";
  }

  /** End the run (if it has not ended) and return the scored result. */
  finish(reason: EndReason = "agent_finished"): RunResult {
    if (this.state === "ready") throw new ConflictError("the run has not started");
    if (this.state === "running") this.end(reason);
    return this.result as RunResult;
  }

  /** Simulated seconds left before the task's time limit. */
  remaining(): number {
    if (!this.task) return Number.POSITIVE_INFINITY;
    return this.task.startedAt + this.task.timeLimitSeconds - this.world.time();
  }

  /** Move simulated time forward, landing exactly on scenario wake-ups. */
  private advance(seconds: number): void {
    const end = this.world.time() + seconds;
    for (let now = this.world.time(); now < end - 1e-9; now = this.world.time()) {
      const wake = this.runner.nextWakeAt();
      const toWake = wake !== undefined && wake > now ? wake - now : Number.POSITIVE_INFINITY;
      this.physics.step(Math.min(DEFAULT_PHYSICS.stepSeconds, end - now, toWake));
      this.runner.tick();
      this.recorder.sampleIfDue();
    }
  }

  private end(reason: EndReason): void {
    this.state = "ended";
    const endedAt = this.world.time();
    if (reason !== "cancelled") this.advance(this.config.aftermathSeconds ?? 60);
    const task = this.task as AgentTask;
    const outcome = {
      doc: this.config.scenario,
      world: this.world,
      toolCalls: this.calls,
      endReason: reason,
      agentStartedAt: task.startedAt,
      ...(this.diagnosis
        ? { diagnosis: this.diagnosis, diagnosedAt: this.diagnosedAt as number }
        : {}),
    };
    this.result = {
      score: score(outcome),
      endReason: reason,
      task,
      toolCalls: this.calls,
      ...(this.diagnosis
        ? { diagnosis: this.diagnosis, diagnosedAt: this.diagnosedAt as number }
        : {}),
      timeline: buildTimeline(
        this.config.scenario,
        this.runner.trace(),
        this.world.events(),
        this.calls,
        this.scenarioStart,
      ),
      series: this.keySeries(),
      digests: {
        world: blueprintDigest(this.config.blueprint),
        scenario: scenarioDigest(this.config.scenario),
        oracle: ORACLE_VERSION,
      },
      seed: this.config.seed,
      simTime: { scenarioStart: this.scenarioStart, agentStart: task.startedAt, end: endedAt },
      recorderBytes: this.recorder.bytes,
    };
  }

  /** Entities worth charting: the answer, what the agent acted on, and what raised alarms. */
  private keyEntities(): Set<string> {
    const answers = this.config.scenario.expectations.flatMap((e) =>
      e.kind === "diagnosis" ? e.rootCause : [],
    );
    const touched = this.calls.flatMap((c) => (c.effects ?? []).map((e) => e.target));
    const alarmed = this.world
      .events()
      .flatMap((e) =>
        e.type === "alarm.raise" && e.t >= this.scenarioStart ? [e.alarm.entityId] : [],
      );
    return new Set([...answers, ...touched, ...alarmed]);
  }

  /** Their recorded series since the scenario started, at most MAX_SERIES. */
  private keySeries(): MetricSeries[] {
    const pairs = [...this.keyEntities()].flatMap((id) => {
      const kind = this.world.index.find(id)?.kind;
      return (kind ? (RECORDED_METRICS[kind] ?? []) : []).map((metric) => [id, metric] as const);
    });
    return pairs.slice(0, MAX_SERIES).map(([entityId, metric]) => ({
      entityId,
      metric,
      points: this.recorder.series(entityId, metric, this.scenarioStart),
    }));
  }
}
