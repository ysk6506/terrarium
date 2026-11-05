/**
 * The control plane's side of one worker node (ADR-0032). `RemoteNode` is the HTTP client;
 * `RemoteSession` makes a session on that node look like any other HostedSession, so the executor
 * cannot tell a node on another machine from a thread in this process.
 */
import type { EndReason } from "@terrarium/core/oracle";
import type { CallResult, RunResult } from "@terrarium/core/session";
import {
  type HostedSession,
  identityOf,
  type PlainSessionConfig,
  raise,
  type WorkerError,
} from "../runtime";
import {
  type ErrorReply,
  NEED_BLUEPRINT,
  NODE_DRAINING,
  NODE_FULL,
  NODE_PATH,
  type NodeReport,
  type OpenReply,
  type OpenRequest,
  type StateReply,
} from "./protocol";

/** The node did not answer (down, unplugged, too slow). The sessions on it are lost. */
export class NodeUnreachable extends Error {
  constructor(
    readonly nodeId: string,
    detail: string,
  ) {
    super(`세션을 돌리던 노드 ${nodeId}가 멈췄어요: ${detail}`);
    this.name = "NodeUnreachable";
  }
}

/** The node had no free slot or is draining; the caller should try another node. */
export class NodeRefused extends Error {
  constructor(
    readonly nodeId: string,
    readonly code: string,
  ) {
    super(`노드 ${nodeId}가 새 세션을 받지 않아요 (${code})`);
    this.name = "NodeRefused";
  }
}

export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

export interface RemoteNodeOptions {
  readonly id: string;
  readonly url: string;
  readonly token: string;
  readonly fetch?: Fetch;
  /** Longest a single request may take (a tool call, a finish with scoring). */
  readonly timeoutMs?: number;
  /** Polling period for realtime sessions' end signal. */
  readonly pollMs?: number;
}

export class RemoteNode {
  /** Worlds this node is known to hold, so most opens carry only a digest. */
  private readonly known = new Set<string>();

  constructor(private readonly options: RemoteNodeOptions) {}

  get id(): string {
    return this.options.id;
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const o = this.options;
    const send = o.fetch ?? ((u, init) => fetch(u, init));
    let res: Response;
    try {
      res = await send(`${o.url}${NODE_PATH}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${o.token}`,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(o.timeoutMs ?? 120_000),
      });
    } catch (err) {
      throw new NodeUnreachable(o.id, err instanceof Error ? err.message : String(err));
    }
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      throw new NodeUnreachable(o.id, `응답을 읽을 수 없어요 (HTTP ${res.status})`);
    }
    if (res.ok) return json as T;
    const error = (json as Partial<ErrorReply> | undefined)?.error;
    if (!error) throw new NodeUnreachable(o.id, `HTTP ${res.status}`);
    throw error as WorkerError;
  }

  status(): Promise<NodeReport> {
    return this.request("GET", "/status");
  }

  drain(): Promise<NodeReport> {
    return this.request("POST", "/drain");
  }

  /** Open a session here. Throws NodeRefused when the node is full or draining. */
  async open(config: PlainSessionConfig): Promise<RemoteSession> {
    const { blueprint, world, ...slim } = config;
    const digest = (world ?? identityOf(blueprint)).digest;
    const attempt = (withWorld: boolean) =>
      this.request<OpenReply>("POST", "/sessions", {
        config: slim,
        digest,
        ...(withWorld ? { blueprint } : {}),
      } satisfies OpenRequest);
    let reply: OpenReply;
    try {
      reply = await attempt(!this.known.has(digest));
    } catch (err) {
      const code = (err as Partial<WorkerError>).code;
      if (code === NEED_BLUEPRINT) reply = await this.retryWithWorld(attempt);
      else if (code === NODE_FULL || code === NODE_DRAINING) throw new NodeRefused(this.id, code);
      else throw this.translate(err);
    }
    this.known.add(digest);
    return new RemoteSession(this, reply, config.time?.kind === "realtime", this.options.pollMs);
  }

  private async retryWithWorld(attempt: (withWorld: boolean) => Promise<OpenReply>) {
    try {
      return await attempt(true);
    } catch (err) {
      const code = (err as Partial<WorkerError>).code;
      if (code === NODE_FULL || code === NODE_DRAINING) throw new NodeRefused(this.id, code);
      throw this.translate(err);
    }
  }

  /** Errors the node sent as data become the same kind of error they were. */
  translate(err: unknown): Error {
    if (err instanceof Error) return err;
    const e = err as WorkerError;
    return raise(e);
  }
}

export class RemoteSession implements HostedSession {
  readonly task: OpenReply["task"];
  readonly specs: OpenReply["specs"];
  private ended: EndReason | undefined;
  private gone = false;
  private readonly timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly node: RemoteNode,
    private readonly opened: OpenReply,
    realtime: boolean,
    pollMs = 1000,
  ) {
    this.task = opened.task;
    this.specs = opened.specs;
    if (realtime) {
      this.timer = setInterval(() => void this.poll(), pollMs);
      this.timer.unref();
    }
  }

  get endedBy(): EndReason | undefined {
    return this.ended;
  }

  private async poll(): Promise<void> {
    if (this.gone) return;
    try {
      const state = await this.node.request<StateReply>("GET", `/sessions/${this.opened.id}`);
      if (state.endedBy !== undefined) this.ended = state.endedBy;
    } catch {
      // A silent node is noticed by the next call, which fails the run; nothing to decide here.
    }
  }

  private path(tail: string): string {
    return `/sessions/${this.opened.id}${tail}`;
  }

  async call(tool: string, args: Record<string, unknown>): Promise<CallResult> {
    try {
      const result = await this.node.request<CallResult>("POST", this.path("/call"), {
        tool,
        args,
      });
      if (result.ended !== undefined) this.ended = result.ended;
      return result;
    } catch (err) {
      throw this.node.translate(err);
    }
  }

  async finish(reason?: EndReason): Promise<RunResult> {
    this.stop();
    try {
      return await this.node.request<RunResult>("POST", this.path("/finish"), { reason });
    } catch (err) {
      throw this.node.translate(err);
    }
  }

  private stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  dispose(): void {
    if (this.gone) return;
    this.gone = true;
    this.stop();
    // Best effort: a node that is already gone has nothing left to free.
    void this.node.request("DELETE", this.path("")).catch(() => undefined);
  }
}
