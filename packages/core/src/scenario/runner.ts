/**
 * Runs a scenario flow in simulated time (REQ-001, REQ-014, REQ-034). The session owns time: it moves
 * the world forward (physics) and calls `tick()` after each step; the runner then executes every block
 * that is due. Blocks fed by one output run in parallel. Everything is deterministic for a given seed.
 */
import { asTerrariumError, InvalidValueError, SeededRng } from "@terrarium/core/kernel";
import type { FaultType, WorldPort } from "@terrarium/core/world";
import { blockSpec, outputsOf, type ParamSpec } from "./blocks";
import { type AgentSignals, evaluate } from "./conditions";
import type { Condition, ScenarioDoc, ScenarioNode } from "./model";

export interface AgentTask {
  readonly nodeId: string;
  readonly prompt: string;
  readonly maxToolCalls: number;
  readonly timeLimitSeconds: number;
  /** Simulated time the task was handed to the agent. */
  readonly startedAt: number;
}

export interface TraceEntry {
  readonly t: number;
  readonly nodeId: string;
  readonly what: "ran" | "waiting" | "resumed" | "met" | "timeout" | "chose" | "expired" | "error";
  readonly detail?: string;
}

type TokenKind = "enter" | "wait" | "poll" | "expire";
interface Token {
  readonly seq: number;
  readonly nodeId: string;
  readonly kind: TokenKind;
  readonly wakeAt: number;
  readonly since: number;
  /** For "expire": the fault to remove. */
  readonly faultId?: string;
  /** Last tick a poll token was checked, so each tick checks it once. */
  checkedAt?: number;
}

const MAX_STEPS_PER_TICK = 10_000;

export class ScenarioRunner {
  private readonly nodes: ReadonlyMap<string, ScenarioNode>;
  private tokens: Token[] = [];
  private seq = 0;
  private readonly entries = new Map<string, number>();
  private readonly injected = new Map<string, string>();
  private readonly log: TraceEntry[] = [];
  private task: AgentTask | undefined;

  constructor(
    private readonly doc: ScenarioDoc,
    private readonly world: WorldPort,
    private readonly seed: number,
    private readonly agent: AgentSignals,
  ) {
    this.nodes = new Map(doc.nodes.map((n) => [n.id, n]));
  }

  /** Put the flow at its start block. Call `tick()` to run what is due. */
  start(): void {
    const start = this.doc.nodes.find((n) => n.type === "start");
    if (!start) throw new InvalidValueError("scenario has no start block");
    this.push(start.id, "enter", this.world.time());
  }

  /** Run every block that is due at the current simulated time. */
  tick(): AgentTask[] {
    const now = this.world.time();
    const started: AgentTask[] = [];
    for (let steps = 0; ; steps++) {
      const due = this.nextDue(now);
      if (!due) return started;
      if (steps >= MAX_STEPS_PER_TICK)
        throw new InvalidValueError("scenario did not settle within one tick");
      this.step(due, now, started);
    }
  }

  /** The earliest future simulated time at which a block will resume (waits, fault expiry). */
  nextWakeAt(): number | undefined {
    const now = this.world.time();
    const times = this.tokens.filter((t) => t.wakeAt > now).map((t) => t.wakeAt);
    return times.length > 0 ? Math.min(...times) : undefined;
  }

  /** True while some block is still waiting or polling. */
  get active(): boolean {
    return this.tokens.length > 0;
  }

  get agentTask(): AgentTask | undefined {
    return this.task;
  }

  trace(): readonly TraceEntry[] {
    return this.log;
  }

  private nextDue(now: number): Token | undefined {
    let best: Token | undefined;
    for (const t of this.tokens) {
      if (t.wakeAt > now || t.checkedAt === now) continue;
      if (!best || t.wakeAt < best.wakeAt || (t.wakeAt === best.wakeAt && t.seq < best.seq))
        best = t;
    }
    return best;
  }

  private push(nodeId: string, kind: TokenKind, wakeAt: number, faultId?: string): void {
    const since = this.world.time();
    this.tokens.push({
      seq: this.seq++,
      nodeId,
      kind,
      wakeAt,
      since,
      ...(faultId ? { faultId } : {}),
    });
  }

  private note(nodeId: string, what: TraceEntry["what"], detail?: string): void {
    this.log.push({
      t: this.world.time(),
      nodeId,
      what,
      ...(detail !== undefined ? { detail } : {}),
    });
  }

  private follow(node: ScenarioNode, port: string, now: number): void {
    const edges = this.doc.edges.filter((e) => e.from === node.id && e.port === port);
    for (const edge of [...edges].sort((a, b) => a.id.localeCompare(b.id)))
      this.push(edge.to, "enter", now);
  }

  private step(token: Token, now: number, started: AgentTask[]): void {
    const node = this.nodes.get(token.nodeId) as ScenarioNode;
    if (token.kind === "poll") {
      this.poll(token, node, now);
      return;
    }
    this.tokens = this.tokens.filter((t) => t !== token);
    if (token.kind === "expire") {
      this.expire(node, token.faultId as string);
      return;
    }
    let port: string | undefined = "next";
    if (token.kind === "wait") this.note(node.id, "resumed");
    else {
      try {
        port = this.enter(node, now, started);
      } catch (e) {
        // A block that cannot act (e.g. its target vanished) is recorded and the flow goes on.
        this.note(node.id, "error", asTerrariumError(e).message);
      }
    }
    if (port !== undefined) this.follow(node, port, now);
  }

  private poll(token: Token, node: ScenarioNode, now: number): void {
    const met = evaluate(node.params.condition as Condition, this.world, this.agent);
    const timedOut = now - token.since >= this.num(node, "timeoutSeconds");
    if (!met && !timedOut) {
      token.checkedAt = now;
      return;
    }
    this.tokens = this.tokens.filter((t) => t !== token);
    this.note(node.id, met ? "met" : "timeout");
    this.follow(node, met ? "met" : "timeout", now);
  }

  private expire(node: ScenarioNode, faultId: string): void {
    if (this.world.faults().some((f) => f.id === faultId)) {
      this.world.apply({ type: "fault.remove", faultId }, `scenario:${node.id}`);
      this.note(node.id, "expired", faultId);
    }
  }

  /** Do what the block does; return the output to continue on, or undefined while it waits. */
  private enter(node: ScenarioNode, now: number, started: AgentTask[]): string | undefined {
    switch (node.type) {
      case "wait":
        this.push(node.id, "wait", now + this.num(node, "seconds"));
        this.note(node.id, "waiting");
        return undefined;
      case "wait_until":
        this.push(node.id, "poll", now);
        this.note(node.id, "waiting");
        return undefined;
      case "branch": {
        const port = evaluate(node.params.condition as Condition, this.world, this.agent)
          ? "yes"
          : "no";
        this.note(node.id, "chose", port);
        return port;
      }
      case "random": {
        const port = this.choose(node);
        this.note(node.id, "chose", port);
        return port;
      }
      default:
        this.act(node, now, started);
        this.note(node.id, "ran");
        return "next";
    }
  }

  private act(node: ScenarioNode, now: number, started: AgentTask[]): void {
    const cause = `scenario:${node.id}`;
    const target = String(node.params.target ?? "");
    switch (node.type) {
      case "inject_fault":
        this.inject(node, now);
        break;
      case "clear_fault":
        this.clear(node);
        break;
      case "set_load":
        this.world.apply({ type: "load.set", target, value: this.num(node, "value") }, cause);
        break;
      case "set_setpoint":
        this.world.apply(
          { type: "setpoint.set", target, celsius: this.num(node, "celsius") },
          cause,
        );
        break;
      case "power":
        this.world.apply({ type: "power.set", target, on: node.params.on === true }, cause);
        break;
      case "agent_task":
        this.startAgent(node, now, started);
        break;
    }
  }

  private choose(node: ScenarioNode): string {
    const visit = this.visit(node.id);
    return new SeededRng(this.seed).fork(`random:${node.id}:${visit}`).pick(outputsOf(node));
  }

  private visit(nodeId: string): number {
    const n = (this.entries.get(nodeId) ?? 0) + 1;
    this.entries.set(nodeId, n);
    return n;
  }

  private inject(node: ScenarioNode, now: number): void {
    const visit = this.visit(node.id);
    const id = visit === 1 ? `scn:${node.id}` : `scn:${node.id}#${visit}`;
    const params = (node.params.faultParams ?? {}) as Readonly<Record<string, number>>;
    const type = node.params.faultType as FaultType;
    this.world.apply(
      { type: "fault.add", fault: { id, type, target: String(node.params.target), params } },
      `scenario:${node.id}`,
    );
    this.injected.set(node.id, id);
    const duration = this.num(node, "durationSeconds");
    if (duration > 0) this.push(node.id, "expire", now + duration, id);
  }

  private clear(node: ScenarioNode): void {
    const id = this.injected.get(String(node.params.ref));
    if (id && this.world.faults().some((f) => f.id === id))
      this.world.apply({ type: "fault.remove", faultId: id }, `scenario:${node.id}`);
  }

  private startAgent(node: ScenarioNode, now: number, started: AgentTask[]): void {
    this.task = {
      nodeId: node.id,
      prompt: String(node.params.prompt ?? ""),
      maxToolCalls: this.num(node, "maxToolCalls"),
      timeLimitSeconds: this.num(node, "timeLimitSeconds"),
      startedAt: now,
    };
    started.push(this.task);
  }

  /** A numeric parameter, or the block's default. */
  private num(node: ScenarioNode, name: string): number {
    const value = node.params[name];
    if (typeof value === "number") return value;
    // Only called for numeric parameters of known blocks, which always have a default.
    const param = blockSpec(node.type)?.params.find((p) => p.name === name);
    return (param as Extract<ParamSpec, { kind: "number" }>).default;
  }
}
