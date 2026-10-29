/**
 * The SessionHost of a control plane that has worker nodes (ADR-0032). It places each new session on
 * the least busy place that will take it — this process's own threads or a registered node — and
 * hands back a session that behaves like any other. Placement is the only thing decided here.
 */
import { ConflictError } from "@terrarium/core/kernel";
import type { HostedSession, PlainSessionConfig, SessionHost } from "../runtime";
import type { NodeRegistry } from "./registry";
import { type Fetch, NodeRefused, NodeUnreachable, RemoteNode } from "./remote-host";

export interface ClusterHostOptions {
  readonly registry: NodeRegistry;
  readonly token: string;
  /** This process's own sessions (omit for a pure control plane). */
  readonly local?: { readonly host: SessionHost; readonly slots: number };
  readonly fetch?: Fetch;
  readonly timeoutMs?: number;
  readonly pollMs?: number;
}

interface Place {
  readonly id: string;
  readonly slots: number;
  readonly open: () => number;
  start(config: PlainSessionConfig): Promise<HostedSession>;
}

export class ClusterHost implements SessionHost {
  private readonly clients = new Map<string, { url: string; node: RemoteNode }>();
  /** Sessions this control plane has placed on each node and not yet released. */
  private readonly placed = new Map<string, number>();

  constructor(private readonly options: ClusterHostOptions) {}

  /** Sessions that could run at once: own slots plus every node that is taking sessions. */
  get capacity(): number {
    return (this.options.local?.slots ?? 0) + this.options.registry.capacity;
  }

  get openCount(): number {
    let n = this.options.local?.host.openCount ?? 0;
    for (const count of this.placed.values()) n += count;
    return n;
  }

  /** Sessions on one node, by this control plane's own count. */
  placedOn(nodeId: string): number {
    return this.placed.get(nodeId) ?? 0;
  }

  private client(id: string, url: string): RemoteNode {
    const known = this.clients.get(id);
    if (known && known.url === url) return known.node;
    const o = this.options;
    const node = new RemoteNode({
      id,
      url,
      token: o.token,
      ...(o.fetch ? { fetch: o.fetch } : {}),
      ...(o.timeoutMs ? { timeoutMs: o.timeoutMs } : {}),
      ...(o.pollMs ? { pollMs: o.pollMs } : {}),
    });
    this.clients.set(id, { url, node });
    return node;
  }

  private places(): Place[] {
    const places: Place[] = [];
    const local = this.options.local;
    if (local && local.slots > 0)
      places.push({
        id: "local",
        slots: local.slots,
        open: () => local.host.openCount,
        start: (config) => local.host.open(config),
      });
    for (const n of this.options.registry.accepting()) {
      const node = this.client(n.id, n.url);
      places.push({
        id: n.id,
        slots: n.slots,
        open: () => this.placedOn(n.id),
        start: async (config) => {
          const session = await node.open(config);
          this.placed.set(n.id, this.placedOn(n.id) + 1);
          return this.release(n.id, session);
        },
      });
    }
    // Least utilised first; ties keep a stable order so placement is predictable.
    return places
      .filter((p) => p.open() < p.slots)
      .sort((a, b) => a.open() / a.slots - b.open() / b.slots || a.id.localeCompare(b.id));
  }

  /** Give the slot back exactly once, however the session ends. */
  private release(nodeId: string, session: HostedSession): HostedSession {
    let released = false;
    const free = () => {
      if (released) return;
      released = true;
      this.placed.set(nodeId, Math.max(0, this.placedOn(nodeId) - 1));
    };
    return {
      task: session.task,
      specs: session.specs,
      get endedBy() {
        return session.endedBy;
      },
      call: (tool, args) => session.call(tool, args),
      finish: (reason) => session.finish(reason),
      dispose: () => {
        free();
        session.dispose();
      },
    };
  }

  async open(config: PlainSessionConfig): Promise<HostedSession> {
    let last: unknown;
    for (const place of this.places()) {
      try {
        return await place.start(config);
      } catch (err) {
        // A full, draining or silent node is not this run's fault: try the next place.
        if (!(err instanceof NodeRefused || err instanceof NodeUnreachable)) throw err;
        last = err;
      }
    }
    throw new ConflictError(
      `세션을 돌릴 자리가 없다${last instanceof Error ? ` (${last.message})` : ""}`,
    );
  }

  async close(): Promise<void> {
    await this.options.local?.host.close();
  }
}
