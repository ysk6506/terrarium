/**
 * A worker node's HTTP face (ADR-0032): the control plane opens sessions here and drives them with
 * the same calls a local host gets. The node holds sessions in whatever SessionHost it was given
 * (worker threads in production), so a node is "the existing runtime behind a socket".
 */
import { randomUUID } from "node:crypto";
import { TerrariumError, wallClockMs } from "@terrarium/core/kernel";
import type { EndReason } from "@terrarium/core/oracle";
import { type Blueprint, blueprintDigest } from "@terrarium/core/world";
import fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import { errorOf, type HostedSession, type SessionHost } from "../runtime";
import {
  bearerMatches,
  type ErrorReply,
  type HumanOp,
  type HumanReply,
  NEED_BLUEPRINT,
  NODE_DRAINING,
  NODE_FULL,
  NODE_PATH,
  type NodeReport,
  type OpenReply,
  type OpenRequest,
  type StateReply,
} from "./protocol";

export interface NodeServerOptions {
  readonly host: SessionHost;
  readonly token: string;
  readonly id: string;
  /** Where the control plane reaches this node. */
  readonly url: string;
  readonly slots: number;
  readonly version: string;
  /** Worlds kept by digest so a world travels once per node, not once per run. */
  readonly blueprintCache?: number;
  /** A session nobody has touched for this long is abandoned (its control plane died). */
  readonly idleMs?: number;
}

interface Held {
  readonly session: HostedSession;
  touched: number;
}

const STATUS: Readonly<Record<string, number>> = {
  invalid_value: 400,
  not_found: 404,
  conflict: 409,
  unsupported: 422,
};

export class NodeServer {
  readonly app: FastifyInstance;
  private readonly held = new Map<string, Held>();
  private readonly blueprints = new Map<string, Blueprint>();
  private draining = false;
  private reaper: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly options: NodeServerOptions) {
    this.app = fastify({ logger: false, bodyLimit: 64 * 1024 * 1024 });
    this.routes();
  }

  report(): NodeReport {
    const o = this.options;
    return {
      id: o.id,
      url: o.url,
      slots: o.slots,
      open: this.held.size,
      draining: this.draining,
      version: o.version,
    };
  }

  /** Take nothing new; what is running finishes. */
  drain(): NodeReport {
    this.draining = true;
    return this.report();
  }

  /** Dispose sessions nobody has touched for `idleMs`. Returns how many were abandoned. */
  reap(): number {
    const limit = this.options.idleMs ?? 3_600_000;
    let n = 0;
    for (const [id, h] of [...this.held]) {
      if (wallClockMs() - h.touched <= limit) continue;
      this.release(id);
      n++;
    }
    return n;
  }

  startReaper(everyMs = 60_000): void {
    this.reaper = setInterval(() => this.reap(), everyMs);
    this.reaper.unref();
  }

  async close(): Promise<void> {
    if (this.reaper) clearInterval(this.reaper);
    for (const id of [...this.held.keys()]) this.release(id);
    await this.app.close();
  }

  private release(id: string): void {
    const h = this.held.get(id);
    if (!h) return;
    this.held.delete(id);
    h.session.dispose();
  }

  private fail(reply: FastifyReply, status: number, message: string, code?: string) {
    const body: ErrorReply = { error: { message, ...(code ? { code } : {}) } };
    return reply.code(status).send(body);
  }

  private failWith(reply: FastifyReply, err: unknown) {
    const e = errorOf(err);
    const status = err instanceof TerrariumError ? (STATUS[err.code] ?? 500) : 500;
    return this.fail(reply, status, e.message, e.code);
  }

  private find(id: string, reply: FastifyReply): Held | undefined {
    const h = this.held.get(id);
    if (!h) {
      this.fail(reply, 404, `세션 ${id}가 이 노드에 없어요`, "not_found");
      return undefined;
    }
    h.touched = wallClockMs();
    return h;
  }

  private remember(digest: string, bp: Blueprint): void {
    this.blueprints.delete(digest);
    this.blueprints.set(digest, bp);
    const limit = this.options.blueprintCache ?? 64;
    for (const key of this.blueprints.keys()) {
      if (this.blueprints.size <= limit) break;
      this.blueprints.delete(key);
    }
  }

  private async open(body: OpenRequest, reply: FastifyReply) {
    if (this.draining) return this.fail(reply, 503, "노드가 비워지는 중이에요", NODE_DRAINING);
    if (this.held.size >= this.options.slots)
      return this.fail(reply, 503, "노드에 빈 자리가 없어요", NODE_FULL);
    let blueprint = this.blueprints.get(body.digest);
    if (body.blueprint) {
      if (blueprintDigest(body.blueprint) !== body.digest)
        return this.fail(reply, 400, "세계와 다이제스트가 맞지 않아요", "invalid_value");
      blueprint = body.blueprint;
    }
    if (!blueprint) return this.fail(reply, 409, "이 노드는 아직 세계를 몰라요", NEED_BLUEPRINT);
    this.remember(body.digest, blueprint);
    const id = randomUUID();
    // Reserve the slot before the await so two simultaneous opens cannot both take the last one.
    this.held.set(id, { session: PENDING, touched: wallClockMs() });
    try {
      const session = await this.options.host.open({
        ...body.config,
        blueprint,
        world: { key: `${blueprint.id}@${body.digest}`, digest: body.digest },
      });
      this.held.set(id, { session, touched: wallClockMs() });
      const out: OpenReply = { id, task: session.task, specs: session.specs };
      return reply.code(201).send(out);
    } catch (err) {
      this.held.delete(id);
      return this.failWith(reply, err);
    }
  }

  private routes(): void {
    const app = this.app;
    app.get("/healthz", async () => ({ ok: true }));
    app.addHook("onRequest", async (req, reply) => {
      if (!req.url.startsWith(NODE_PATH)) return;
      if (!bearerMatches(req.headers.authorization, this.options.token))
        return this.fail(reply, 401, "토큰이 맞지 않아요", "unauthorized");
    });
    app.get(`${NODE_PATH}/status`, async () => this.report());
    app.post(`${NODE_PATH}/drain`, async () => this.drain());
    app.post(`${NODE_PATH}/sessions`, async (req, reply) =>
      this.open(req.body as OpenRequest, reply),
    );
    app.get(`${NODE_PATH}/sessions/:id`, async (req, reply) => {
      const h = this.find((req.params as { id: string }).id, reply);
      if (!h) return reply;
      const out: StateReply = h.session.endedBy === undefined ? {} : { endedBy: h.session.endedBy };
      return out;
    });
    app.post(`${NODE_PATH}/sessions/:id/call`, async (req, reply) => {
      const h = this.find((req.params as { id: string }).id, reply);
      if (!h) return reply;
      const { tool, args } = req.body as { tool: string; args: Record<string, unknown> };
      try {
        return await h.session.call(tool, args ?? {});
      } catch (err) {
        return this.failWith(reply, err);
      }
    });
    app.post(`${NODE_PATH}/sessions/:id/human`, async (req, reply) => {
      const h = this.find((req.params as { id: string }).id, reply);
      if (!h) return reply;
      const op = req.body as HumanOp;
      try {
        const act =
          op.kind === "act" ? await h.session.humanAct(op.tool, op.args ?? {}) : undefined;
        const result =
          op.kind === "resolve" ? await h.session.resolveHuman(op.resolution) : undefined;
        const out: HumanReply = {
          ...(act ? { act } : {}),
          ...(result ? { result } : {}),
          specs: h.session.specs,
        };
        return out;
      } catch (err) {
        return this.failWith(reply, err);
      }
    });
    app.post(`${NODE_PATH}/sessions/:id/finish`, async (req, reply) => {
      const id = (req.params as { id: string }).id;
      const h = this.find(id, reply);
      if (!h) return reply;
      const { reason } = (req.body ?? {}) as { reason?: EndReason };
      try {
        return await h.session.finish(reason);
      } catch (err) {
        return this.failWith(reply, err);
      }
    });
    app.delete(`${NODE_PATH}/sessions/:id`, async (req, reply) => {
      this.release((req.params as { id: string }).id);
      return reply.code(204).send();
    });
  }
}

/** Stands in for a session between taking its slot and finishing its open. */
const PENDING: HostedSession = {
  task: undefined as never,
  specs: [],
  endedBy: undefined,
  call: async () => {
    throw new Error("세션이 아직 열리는 중이에요");
  },
  finish: async () => {
    throw new Error("세션이 아직 열리는 중이에요");
  },
  humanAct: async () => {
    throw new Error("세션이 아직 열리는 중이에요");
  },
  resolveHuman: async () => {
    throw new Error("세션이 아직 열리는 중이에요");
  },
  dispose: () => undefined,
};
