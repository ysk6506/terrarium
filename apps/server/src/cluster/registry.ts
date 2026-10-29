/**
 * Which worker nodes exist right now (ADR-0032). Nodes announce themselves with heartbeats; one that
 * stays quiet longer than the time-to-live is gone, however politely it left. Capacity is the sum of
 * the slots of nodes that are alive and not draining.
 */
import { wallClockMs } from "@terrarium/core/kernel";
import { checkedNodeUrl, type NodeReport } from "./protocol";

export interface KnownNode extends NodeReport {
  /** Wall-clock ms of the last heartbeat. */
  readonly seenAt: number;
}

export interface RegistryEvents {
  /** A node appeared, changed its slots, started draining, or came back. */
  joined?(node: KnownNode): void;
  /** A node stopped answering, or left. */
  lost?(node: KnownNode, why: "silent" | "left"): void;
}

export class NodeRegistry {
  private readonly nodes = new Map<string, KnownNode>();

  constructor(
    private readonly ttlMs: number,
    private readonly events: RegistryEvents = {},
    private readonly now: () => number = wallClockMs,
  ) {}

  /** A heartbeat. Returns false when the report is not acceptable. */
  beat(report: NodeReport): boolean {
    const url = checkedNodeUrl(report.url);
    if (!url) return false;
    const before = this.nodes.get(report.id);
    const node: KnownNode = { ...report, url, seenAt: this.now() };
    this.nodes.set(report.id, node);
    if (
      !before ||
      before.slots !== node.slots ||
      before.draining !== node.draining ||
      before.url !== url
    )
      this.events.joined?.(node);
    return true;
  }

  /** A node said it is going away. */
  leave(id: string): void {
    const node = this.nodes.get(id);
    if (!node) return;
    this.nodes.delete(id);
    this.events.lost?.(node, "left");
  }

  /** Drop nodes that have been quiet too long. */
  sweep(): KnownNode[] {
    const gone: KnownNode[] = [];
    for (const node of [...this.nodes.values()]) {
      if (this.now() - node.seenAt <= this.ttlMs) continue;
      this.nodes.delete(node.id);
      gone.push(node);
      this.events.lost?.(node, "silent");
    }
    return gone;
  }

  /** Nodes that are alive (draining ones included: they still hold sessions). */
  list(): KnownNode[] {
    return [...this.nodes.values()]
      .filter((n) => this.now() - n.seenAt <= this.ttlMs)
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  /** Nodes that can take a new session. */
  accepting(): KnownNode[] {
    return this.list().filter((n) => !n.draining);
  }

  get(id: string): KnownNode | undefined {
    return this.nodes.get(id);
  }

  /** Mean slots of the nodes taking sessions, or undefined when there are none. */
  averageSlots(): number | undefined {
    const nodes = this.accepting();
    return nodes.length === 0
      ? undefined
      : Math.round(nodes.reduce((sum, n) => sum + n.slots, 0) / nodes.length);
  }

  get capacity(): number {
    return this.accepting().reduce((sum, n) => sum + n.slots, 0);
  }
}
