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
import { type EndReason, ORACLE_VERSION, score } from "@terrarium/core/oracle";
import { DEFAULT_PHYSICS, Physics } from "@terrarium/core/physics";
import {
  type AgentTask,
  type Diagnosis,
  hasErrors,
  ScenarioRunner,
  scenarioDigest,
  type ToolCallRecord,
  validateScenario,
} from "@terrarium/core/scenario";
import {
  type Args,
  runbookPrompt,
  scopeTools,
  Toolbox,
  type ToolContext,
  type ToolResult,
  type ToolSpec,
} from "@terrarium/core/tools";
import { blueprintDigest, type RunEvent, World } from "@terrarium/core/world";
import { HandOffs, scopeOf } from "./hand-offs";
import type { HumanAct, HumanRequest, HumanResolution } from "./human";
import { HumanLine } from "./human-line";
import { keySeries } from "./key-series";
import {
  attachOperation,
  DEFAULT_OPERATION_CALLS,
  type OperationDriver,
  operationReport,
  withDiagnosisNote,
} from "./operation";
import { DEFAULT_RECORDER, MetricRecorder } from "./recorder";
import { RunLog } from "./run-events";
import { effectsSince, extrasOf, faultSkipper, operationEndOf, outsideOf } from "./session-parts";
import { shellPlugOf } from "./shell-plug";
import { buildTimeline } from "./timeline";
import {
  type CallResult,
  DEFAULT_TIME,
  type RunResult,
  type SessionConfig,
  type SessionStatus,
  type TimePolicy,
} from "./types";

export type { SessionConfig } from "./types";

const ALWAYS_TOOLS = ["submit_diagnosis"];

export class Session {
  readonly world: World;
  private readonly physics: Physics;
  private readonly runner: ScenarioRunner;
  private readonly toolbox: Toolbox;
  private readonly recorder: MetricRecorder;
  private readonly ctx: ToolContext;
  private readonly time: TimePolicy;
  private readonly calls: ToolCallRecord[] = [];
  /** Calls spent on the investigation (submitting the answer is free); counted as they come, so a long run is not read again each time. */
  private spent = 0;
  private readonly log: RunLog;
  private readonly handOffs: HandOffs;
  private state: SessionStatus = "ready";
  private task: AgentTask | undefined;
  private diagnosis: Diagnosis | undefined;
  private diagnosedAt: number | undefined;
  private digestOfWorld: string | undefined;
  private scenarioStart = 0;
  private result: RunResult | undefined;
  private readonly line: HumanLine;
  /** Set for an operation run (ADR-0094): the fault generator and the clock. */
  private readonly operation: OperationDriver | undefined;

  private constructor(
    private readonly config: SessionConfig,
    world: World,
  ) {
    this.world = world;
    this.log = new RunLog(world, (id) => world.index.find(id)?.name ?? id);
    this.physics = new Physics(world);
    this.time = config.operation ? { kind: "realtime", speed: 1 } : (config.time ?? DEFAULT_TIME);
    const finder = config.sop === "search" ? ["search_runbooks"] : [];
    this.toolbox = new Toolbox([
      ...new Set([...scopeTools(config.tools, config.domains), ...ALWAYS_TOOLS, ...finder]),
    ]);
    this.handOffs = new HandOffs({
      world,
      log: this.log,
      seed: config.seed,
      leadTimes: config.leadTimes,
      originT: () => this.task?.startedAt ?? world.time(),
      ticketsOn: () => this.toolbox.has("create_ticket"),
    });
    this.recorder = new MetricRecorder(world, {
      sampleSeconds: config.sampleSeconds ?? DEFAULT_RECORDER.sampleSeconds,
      retentionSeconds: config.retentionSeconds ?? DEFAULT_RECORDER.retentionSeconds,
    });
    this.line = new HumanLine(
      {
        world,
        toolbox: this.toolbox,
        recorder: this.recorder,
        log: this.log,
        profiles: config.profiles,
        calls: () => this.calls,
        record: (tool, args, result, t, before) => this.record(tool, args, result, t, before),
        conclude: (tool, args, result, t, before) => this.conclude(tool, args, result, t, before),
        end: (reason) => this.end(reason),
      },
      config.escalation,
    );
    this.runner = new ScenarioRunner(
      config.scenario,
      world,
      config.seed,
      {
        toolCalls: () => this.calls,
        diagnosis: () => this.diagnosis,
        scenarioStart: () => this.scenarioStart,
      },
      { skipFault: faultSkipper(config, this.toolbox) },
    );
    const skip = faultSkipper(config, this.toolbox);
    this.operation = config.operation
      ? attachOperation(config.operation, {
          world,
          seed: config.seed,
          events: () => this.log.events,
          ...(skip ? { skip } : {}),
        })
      : undefined;
    this.ctx = {
      world,
      facades: createFacades(world, config.profiles),
      metrics: this.recorder,
      runbooks: config.sop === "search" && config.scenario.runbook ? [config.scenario.runbook] : [],
      // in an operation the host lets the real time pass before it makes the call (the world follows the clock)
      wait: (seconds) => !this.operation && this.advance(Math.min(seconds, this.remaining())),
      submit: (d) => {
        this.diagnosis = d;
        this.diagnosedAt = world.time();
      },
      ops: this.handOffs.port,
      ...shellPlugOf(
        config,
        this,
        () => this.calls.length,
        (s) => this.advance(s),
      ),
    };
  }

  /** Build a session; refuses an invalid blueprint or scenario with the reasons. */
  static create(config: SessionConfig): Session {
    const catalog = config.catalog ?? new Catalog();
    const world =
      config.prepared && !config.catalog
        ? World.fromPrepared(config.prepared, catalog)
        : World.fromBlueprint(config.blueprint, catalog);
    const issues = validateScenario(config.scenario, { index: world.index, catalog });
    if (hasErrors(issues)) {
      const reasons = issues.filter((i) => i.severity === "error").map((i) => i.message);
      throw new InvalidValueError(`시나리오를 실행할 수 없어요: ${reasons.join("; ")}`);
    }
    return new Session(config, world);
  }

  get status(): SessionStatus {
    return this.state;
  }

  /** How simulated time moves: hosts sync realtime sessions to the wall clock. */
  get timePolicy(): TimePolicy {
    return this.time;
  }

  /** The tools the agent may call, with their JSON schemas (for harness adapters and MCP). */
  toolSpecs(): ToolSpec[] {
    return this.toolbox.list();
  }

  /** Warm up, then play the scenario until it hands the task to the agent. */
  start(): AgentTask {
    if (this.state !== "ready") throw new ConflictError("the session has already started");
    this.warmUp();
    this.scenarioStart = this.world.time();
    this.runner.start();
    this.runner.tick();
    const deadline = this.world.time() + (this.config.maxPreAgentSeconds ?? 86_400);
    while (!this.runner.agentTask) {
      if (this.world.time() >= deadline)
        throw new InvalidValueError("the scenario did not hand the task to the agent in time");
      this.advance(DEFAULT_PHYSICS.stepSeconds);
    }
    // an operation has its own call limit (the scenario editor's range stops at 500)
    const task = this.operation
      ? {
          ...this.runner.agentTask,
          maxToolCalls: this.config.operation?.budget?.maxToolCalls ?? DEFAULT_OPERATION_CALLS,
        }
      : this.runner.agentTask;
    const runbook = this.config.scenario.runbook;
    this.task =
      this.config.sop === "given" && runbook
        ? { ...task, prompt: task.prompt + runbookPrompt(runbook) }
        : task;
    this.state = "running";
    this.operation?.begin(this.task.startedAt);
    this.log.agentStart(this.task.startedAt, this.scenarioStart);
    return this.task;
  }

  /** Bring the world to normal operation: from the cache when this world was warmed before. */
  private warmUp(): void {
    const warmup = this.config.warmupSeconds ?? 600;
    const cache = this.config.catalog ? undefined : this.config.warm;
    const key = cache && this.warmKey(warmup);
    const hit = key && cache ? cache.get(key) : undefined;
    if (hit) {
      this.world.adopt(hit.world);
      this.recorder.adopt(hit.recorder);
      return;
    }
    this.physics.settle();
    this.advance(warmup);
    const recorder = this.recorder.capture();
    if (key && cache && recorder) cache.put(key, { world: this.world.checkpoint(), recorder });
  }

  /** The blueprint's digest, worked out once per session (a prepared world already carries it). */
  private worldDigest(): string {
    this.digestOfWorld ??= this.config.prepared?.digest ?? blueprintDigest(this.config.blueprint);
    return this.digestOfWorld;
  }

  private warmKey(warmup: number): string {
    const o = this.recorder.options;
    return [this.worldDigest(), warmup, o.sampleSeconds, o.retentionSeconds].join("|");
  }

  /** Why a call cannot be made now, as the answer the agent gets; undefined when it can. */
  private refusal(tool: string, t: number): CallResult | undefined {
    if (this.state !== "running") {
      const why =
        this.state === "ready"
          ? "the run has not started"
          : `the run has ended (${this.result?.endReason})`;
      return { ok: false, t, error: why };
    }
    if (this.line.waiting)
      return { ok: false, t, error: "the run is waiting for a person to answer your request" };
    const task = this.task as AgentTask;
    if (tool !== "submit_diagnosis" && this.spent >= task.maxToolCalls) {
      this.end("tool_budget");
      return {
        ok: false,
        t,
        error: `the budget of ${task.maxToolCalls} tool calls is used up; the run has ended`,
        ended: "tool_budget",
      };
    }
    return undefined;
  }

  call(tool: string, args: Args = {}): CallResult {
    const t = this.world.time();
    const refused = this.refusal(tool, t);
    if (refused) return refused;
    this.operation?.touch();
    if (tool === "ask_human" && this.toolbox.has(tool)) return this.line.ask(args, t);
    const before = this.world.lastSeq();
    return this.conclude(tool, args, this.toolbox.call(tool, args, this.ctx), t, before);
  }

  /** Write a finished call into the record, with what it did to the world. */
  private record(tool: string, args: Args, result: ToolResult, t: number, before: number): void {
    const effects = effectsSince(this.world, before);
    if (tool !== "submit_diagnosis") this.spent++;
    this.calls.push({
      t,
      tool,
      args,
      ok: result.ok,
      ...(result.error ? { error: result.error } : {}),
      effects,
      ...outsideOf(tool, result),
    });
    this.log.call(this.calls[this.calls.length - 1] as ToolCallRecord);
  }

  /** A call is done: record it, let time move on per the policy, and end the run if that was the last call (a diagnosis ends it unless this is an operation, ADR-0094). */
  private conclude(
    tool: string,
    args: Args,
    result: ToolResult,
    t: number,
    before: number,
  ): CallResult {
    this.record(tool, args, result, t, before);
    if (tool === "submit_diagnosis" && result.ok && !this.operation) {
      this.end("diagnosed");
      return { ...result, t, ended: "diagnosed" };
    }
    if (this.time.kind === "lockstep" && tool !== "wait")
      this.advance(Math.min(this.time.secondsPerCall, this.remaining()));
    this.log.flush();
    if (this.remaining() <= 0) {
      this.end("time_limit");
      return { ...result, t, ended: "time_limit" };
    }
    return { ...withDiagnosisNote(tool, result, this.operation !== undefined), t };
  }

  // ── asking a person (ADR-0087 item 4; the line itself is in human-line.ts) ─────────────

  /** The request a person is asked to answer right now. */
  get waitingForPerson(): HumanRequest | undefined {
    return this.line.waiting;
  }

  /** A person changes the world for the agent while the run waits; never scored as the agent's. */
  humanAct(tool: string, args: Args): HumanAct {
    return this.line.act(tool, args);
  }

  /** The person has answered: the call the agent waited on gets its result and the run goes on (or ends). */
  resolveHuman(r: HumanResolution): CallResult {
    return this.line.resolve(r);
  }

  /** Realtime policy: move simulated time to `elapsedSeconds` of wall clock after the task began. */
  sync(elapsedSeconds: number): EndReason | undefined {
    if (this.state !== "running" || this.time.kind !== "realtime") return undefined;
    // time stands still while the run waits for a person, and what they kept it waiting is not counted afterwards
    if (this.line.waiting) return undefined;
    if (this.operation) return this.syncOperation(this.operation, elapsedSeconds);
    const target =
      (this.task as AgentTask).startedAt +
      (elapsedSeconds - this.line.pausedSeconds) * this.time.speed;
    const behind = target - this.world.time();
    if (behind > 0) this.advance(Math.min(behind, this.remaining()));
    this.log.flush();
    if (this.remaining() > 0) return undefined;
    this.end("time_limit");
    return "time_limit";
  }

  /** An operation: the clock driver says how much world time the real time since the last sync is worth. */
  private syncOperation(op: OperationDriver, elapsedSeconds: number): EndReason | undefined {
    const step = op.step(elapsedSeconds - this.line.pausedSeconds);
    if (step.worldSeconds > 0) this.advance(Math.min(step.worldSeconds, this.remaining()));
    this.log.flush();
    if (this.remaining() > 0) return undefined;
    this.end("time_limit");
    return "time_limit";
  }

  /** The world's time now, and whether this is an operation (its host lets real time pass for `wait`). */
  get worldTime(): number {
    return this.world.time();
  }

  get operating(): boolean {
    return this.operation !== undefined;
  }

  /** End the run (if it has not ended) and return the scored result. */
  finish(reason: EndReason = "agent_finished"): RunResult {
    if (this.state === "ready") throw new ConflictError("the run has not started");
    if (this.state === "running") this.end(reason);
    return this.result as RunResult;
  }

  /** The run's events after the first `count` of them: what a host shows live (REQ-083). */
  eventsSince(count: number): readonly RunEvent[] {
    return this.log.since(count);
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
      const wakes = [
        this.runner.nextWakeAt(),
        this.handOffs.nextWakeAt(now),
        this.operation?.nextWakeAt(),
      ].filter((w): w is number => w !== undefined && w > now);
      const toWake = wakes.length > 0 ? Math.min(...wakes) - now : Number.POSITIVE_INFINITY;
      this.physics.step(Math.min(DEFAULT_PHYSICS.stepSeconds, end - now, toWake));
      this.runner.tick();
      this.operation?.tick();
      this.handOffs.tick();
      this.recorder.sampleIfDue();
    }
  }

  private end(reason: EndReason): void {
    this.line.abandon();
    this.state = "ended";
    const endedAt = this.world.time();
    if (reason !== "cancelled") this.advance(this.config.aftermathSeconds ?? 60);
    const task = this.task as AgentTask;
    // what the world did while it settled is in the record before the run is read, as a replay of it will read it
    this.log.flush();
    const outcome = {
      doc: this.config.scenario,
      world: this.world,
      ...(this.config.domains ? { domains: this.config.domains } : {}),
      toolCalls: this.calls,
      events: this.log.events,
      endedAt: this.world.time(),
      endReason: reason,
      ...operationEndOf(this.config, task),
      agentStartedAt: task.startedAt,
      scenarioStart: this.scenarioStart,
      ...(this.diagnosis
        ? { diagnosis: this.diagnosis, diagnosedAt: this.diagnosedAt as number }
        : {}),
    };
    const scored = score(outcome);
    this.log.close({
      closedAt: endedAt,
      gradedAt: this.world.time(),
      reason,
      diagnosed: this.diagnosis !== undefined,
      total: scored.total,
      passed: scored.passed,
      rootCause: this.config.scenario.expectations.flatMap((e) =>
        e.kind === "diagnosis" ? e.rootCause : [],
      ),
    });
    this.result = {
      score: scored,
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
        (id) => this.world.index.find(id)?.name ?? id,
      ),
      events: this.log.events,
      series: keySeries({
        world: this.world,
        recorder: this.recorder,
        scenario: this.config.scenario,
        calls: this.calls,
        scenarioStart: this.scenarioStart,
      }),
      digests: {
        world: this.worldDigest(),
        scenario: scenarioDigest(this.config.scenario),
        oracle: ORACLE_VERSION,
        physics: this.world.physics.fingerprint,
      },
      seed: this.config.seed,
      ...scopeOf(this.config.domains, this.config.leadTimes),
      simTime: { scenarioStart: this.scenarioStart, agentStart: task.startedAt, end: endedAt },
      recorderBytes: this.recorder.bytes,
      ...extrasOf(this.config.scenario, this.config.sop, this.toolbox, this.line, this.calls),
      ...(this.operation
        ? { operation: operationReport(this.operation, this.world, this.log.events, endedAt) }
        : {}),
    };
  }
}
