/**
 * A worker node's side of the registry (ADR-0032): tell the control plane "I am here, this is my load"
 * every few seconds, and say goodbye when leaving. The control plane forgets a node that goes quiet,
 * so a crash needs no cleanup.
 */
import { CLUSTER_PATH, type NodeReport } from "./protocol";
import type { Fetch } from "./remote-host";

export interface HeartbeatOptions {
  readonly controlUrl: string;
  readonly token: string;
  readonly report: () => NodeReport;
  readonly everyMs: number;
  readonly fetch?: Fetch;
  /** Told once per failure streak, so a log shows "cannot reach control" once, not every beat. */
  readonly onTrouble?: (message: string | undefined) => void;
}

export class Heartbeat {
  private timer: ReturnType<typeof setInterval> | undefined;
  private failing = false;

  constructor(private readonly options: HeartbeatOptions) {}

  private async post(path: string, body: unknown): Promise<void> {
    const o = this.options;
    const send = o.fetch ?? ((u, init) => fetch(u, init));
    const res = await send(`${o.controlUrl}${CLUSTER_PATH}${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${o.token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(Math.max(1000, o.everyMs)),
    });
    if (!res.ok) throw new Error(`컨트롤이 ${res.status}로 답했다`);
  }

  /** One beat now. Returns whether the control plane heard it. */
  async beat(): Promise<boolean> {
    try {
      await this.post("/heartbeat", this.options.report());
      if (this.failing) this.options.onTrouble?.(undefined);
      this.failing = false;
      return true;
    } catch (err) {
      if (!this.failing) this.options.onTrouble?.(err instanceof Error ? err.message : String(err));
      this.failing = true;
      return false;
    }
  }

  start(): void {
    void this.beat();
    this.timer = setInterval(() => void this.beat(), this.options.everyMs);
    this.timer.unref();
  }

  /** Stop beating and tell the control plane this node is leaving. */
  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    try {
      await this.post("/leave", { id: this.options.report().id });
    } catch {
      // Gone either way: the control plane will notice the silence.
    }
  }
}
