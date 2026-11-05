/**
 * Where sessions run (ADR-0027). A session is CPU work (physics, scenario, scoring); the server's
 * main thread must stay free for HTTP, MCP and the scheduler, so sessions live in worker threads.
 * The in-process host runs them on the calling thread — for tests and tiny deployments — and both
 * hosts answer the same interface, so everything above them is the same.
 */
import { InvalidValueError, wallClockMs } from "@terrarium/core/kernel";
import type { EndReason } from "@terrarium/core/oracle";
import type { AgentTask } from "@terrarium/core/scenario";
import {
  type CallResult,
  type RunResult,
  Session,
  type SessionConfig,
  WarmStartCache,
} from "@terrarium/core/session";
import type { ToolSpec } from "@terrarium/core/tools";
import { identityOf, WorldCache, type WorldIdentity } from "./world-cache";

/**
 * A session config that can cross a thread boundary (no catalog instance, warm cache or prepared world: the host
 * makes its own). `world` says which version of which world the blueprint is, when the caller knows.
 */
export type PlainSessionConfig = Omit<SessionConfig, "catalog" | "warm" | "prepared"> & {
  readonly world?: WorldIdentity;
};

export interface HostedSession {
  readonly task: AgentTask;
  readonly specs: readonly ToolSpec[];
  /** Set once the session has ended (diagnosis, budget, time), before finish() is called. */
  readonly endedBy: EndReason | undefined;
  call(tool: string, args: Record<string, unknown>): Promise<CallResult>;
  finish(reason?: EndReason): Promise<RunResult>;
  /** Forget the session (after finish, or to abandon it). */
  dispose(): void;
}

export interface SessionHost {
  /** Build the session and play it up to the agent's task. */
  open(config: PlainSessionConfig): Promise<HostedSession>;
  /** Sessions open right now. */
  readonly openCount: number;
  close(): Promise<void>;
}

const REALTIME_TICK_MS = 1000;

/**
 * One session driven on this thread. Realtime sessions are synced to the wall clock on a timer;
 * the clock is read here, in the host, never inside the session (REQ-001).
 */
export class LocalSession implements HostedSession {
  readonly task: AgentTask;
  readonly specs: readonly ToolSpec[];
  private ended: EndReason | undefined;
  private readonly timer: ReturnType<typeof setInterval> | undefined;
  private readonly startedWall = wallClockMs();

  constructor(
    private readonly session: Session,
    private readonly onEnd?: (reason: EndReason) => void,
  ) {
    this.task = session.start();
    this.specs = session.toolSpecs();
    this.timer =
      session.timePolicy.kind === "realtime"
        ? setInterval(() => this.sync(), REALTIME_TICK_MS)
        : undefined;
  }

  get endedBy(): EndReason | undefined {
    return this.ended;
  }

  private markEnded(reason: EndReason | undefined): void {
    if (reason === undefined || this.ended !== undefined) return;
    this.ended = reason;
    if (this.timer) clearInterval(this.timer);
    this.onEnd?.(reason);
  }

  /** Catch simulated time up with the wall clock (realtime policy). */
  sync(): void {
    this.markEnded(this.session.sync((wallClockMs() - this.startedWall) / 1000));
  }

  async call(tool: string, args: Record<string, unknown>): Promise<CallResult> {
    if (this.timer) this.sync();
    const result = this.session.call(tool, args);
    this.markEnded(result.ended);
    return result;
  }

  async finish(reason?: EndReason): Promise<RunResult> {
    if (this.timer) clearInterval(this.timer);
    return this.session.finish(reason);
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
  }
}

export class InProcessHost implements SessionHost {
  private count = 0;
  private readonly warm = new WarmStartCache();
  private readonly worlds = new WorldCache();

  get openCount(): number {
    return this.count;
  }

  async open(config: PlainSessionConfig): Promise<HostedSession> {
    const { world, ...rest } = config;
    const identity = world ?? identityOf(config.blueprint);
    const prepared =
      this.worlds.get(identity.key) ?? this.worlds.prepare(identity, config.blueprint);
    const local = new LocalSession(Session.create({ ...rest, warm: this.warm, prepared }));
    this.count++;
    let disposed = false;
    const dispose = () => {
      if (disposed) return;
      disposed = true;
      this.count--;
      local.dispose();
    };
    return {
      task: local.task,
      specs: local.specs,
      get endedBy() {
        return local.endedBy;
      },
      call: (tool, args) => local.call(tool, args),
      finish: (reason) => local.finish(reason),
      dispose,
    };
  }

  async close(): Promise<void> {}
}

/** Reject configs that would not survive the trip to a worker. */
export function plainConfig(config: SessionConfig): PlainSessionConfig {
  if (config.catalog !== undefined)
    throw new InvalidValueError("hosted sessions use the built-in catalog");
  const { catalog: _catalog, warm: _warm, prepared: _prepared, ...rest } = config;
  return rest;
}
