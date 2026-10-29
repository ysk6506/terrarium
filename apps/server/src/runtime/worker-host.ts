/**
 * Sessions in a pool of worker threads (ADR-0027). Each session lives on one worker for its whole
 * life; a new session goes to the worker with the fewest. If a worker dies, its sessions fail with a
 * clear reason and a fresh worker takes its place.
 */
import { Worker } from "node:worker_threads";
import {
  ConflictError,
  InvalidValueError,
  NotFoundError,
  type TerrariumError,
  UnsupportedError,
} from "@terrarium/core/kernel";
import type { EndReason } from "@terrarium/core/oracle";
import type { CallResult, RunResult } from "@terrarium/core/session";
import type { HostedSession, PlainSessionConfig, SessionHost } from "./hosts";
import type { FromWorker, ToWorker, WorkerError } from "./worker-protocol";

const ERRORS: Readonly<Record<string, new (message: string) => TerrariumError>> = {
  invalid_value: InvalidValueError,
  not_found: NotFoundError,
  conflict: ConflictError,
  unsupported: UnsupportedError,
};

const raise = (e: WorkerError): Error => {
  const Kind = e.code ? ERRORS[e.code] : undefined;
  return Kind ? new Kind(e.message) : new Error(e.message);
};

interface Pending {
  resolve(value: unknown): void;
  reject(err: Error): void;
}

interface Slot {
  worker: Worker;
  readonly sessions: Set<string>;
}

export interface WorkerHostOptions {
  readonly size: number;
}

const ENTRY = new URL("./session-worker.ts", import.meta.url).href;
/**
 * The worker boots through tsx, so it runs the TypeScript sources (and their path aliases) exactly
 * like the main thread does, whether the server runs under tsx or the tests under vitest.
 */
const BOOT = `import("tsx/esm/api").then((tsx) => { tsx.register(); return import(${JSON.stringify(ENTRY)}); })`;

export class WorkerHost implements SessionHost {
  private readonly slots: Slot[] = [];
  private readonly pending = new Map<string, Pending>();
  private readonly ended = new Map<string, EndReason>();
  private readonly owner = new Map<string, Slot>();
  private seq = 0;
  private nextId = 0;
  private closing = false;

  constructor(options: WorkerHostOptions) {
    if (options.size < 1) throw new InvalidValueError("워커는 하나 이상이어야 한다");
    for (let i = 0; i < options.size; i++) this.slots.push(this.spawn());
  }

  get openCount(): number {
    return this.owner.size;
  }

  private spawn(): Slot {
    const worker = new Worker(BOOT, { eval: true });
    const slot: Slot = { worker, sessions: new Set() };
    worker.on("message", (msg: FromWorker) => this.receive(msg));
    worker.on("error", (err) => this.lost(slot, err.message));
    worker.on("exit", (code) => this.lost(slot, `종료 코드 ${code}`));
    return slot;
  }

  /** A worker died: fail what it held and start a replacement. */
  private lost(slot: Slot, why: string): void {
    const index = this.slots.indexOf(slot);
    if (index < 0) return;
    for (const id of slot.sessions) {
      this.owner.delete(id);
      for (const [key, p] of this.pending)
        if (key.startsWith(`${id}#`)) {
          this.pending.delete(key);
          p.reject(new Error(`세션을 돌리던 워커가 멈췄다 (${why})`));
        }
    }
    slot.sessions.clear();
    if (this.closing) {
      this.slots.splice(index, 1);
      return;
    }
    this.slots[index] = this.spawn();
  }

  private receive(msg: FromWorker): void {
    if (msg.kind === "ended") {
      this.ended.set(msg.id, msg.reason);
      return;
    }
    const key = "seq" in msg ? `${msg.id}#${msg.seq}` : `${msg.id}#open`;
    const p = this.pending.get(key);
    if (!p) return;
    this.pending.delete(key);
    if (msg.kind === "failed" || msg.kind === "open_failed") p.reject(raise(msg.error));
    else p.resolve(msg);
  }

  private request<T>(slot: Slot, key: string, message: ToWorker): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.pending.set(key, { resolve: resolve as (v: unknown) => void, reject });
      slot.worker.postMessage(message);
    });
  }

  private leastBusy(): Slot {
    return this.slots.reduce((best, s) => (s.sessions.size < best.sessions.size ? s : best));
  }

  async open(config: PlainSessionConfig): Promise<HostedSession> {
    if (this.closing) throw new ConflictError("서버가 멈추는 중이다");
    const id = `s${this.nextId++}`;
    const slot = this.leastBusy();
    slot.sessions.add(id);
    this.owner.set(id, slot);
    let opened: Extract<FromWorker, { kind: "opened" }>;
    try {
      opened = await this.request(slot, `${id}#open`, { kind: "open", id, config });
    } catch (err) {
      slot.sessions.delete(id);
      this.owner.delete(id);
      throw err;
    }
    return this.handle(id, opened);
  }

  private send<T>(id: string, build: (seq: number) => ToWorker): Promise<T> {
    const slot = this.owner.get(id);
    if (!slot) return Promise.reject(new Error("세션을 돌리던 워커가 멈췄다"));
    const seq = this.seq++;
    return this.request<T>(slot, `${id}#${seq}`, build(seq));
  }

  private handle(id: string, opened: Extract<FromWorker, { kind: "opened" }>): HostedSession {
    let ended: EndReason | undefined;
    const host = this;
    return {
      task: opened.task,
      specs: opened.specs,
      get endedBy() {
        return ended ?? host.ended.get(id);
      },
      call: async (tool, args) => {
        const msg = await this.send<{ result: CallResult }>(id, (seq) => ({
          kind: "call",
          id,
          seq,
          tool,
          args,
        }));
        if (msg.result.ended) ended = msg.result.ended;
        return msg.result;
      },
      finish: async (reason) => {
        const msg = await this.send<{ result: RunResult }>(id, (seq) => ({
          kind: "finish",
          id,
          seq,
          ...(reason ? { reason } : {}),
        }));
        return msg.result;
      },
      dispose: () => {
        const slot = this.owner.get(id);
        this.owner.delete(id);
        this.ended.delete(id);
        if (!slot) return;
        slot.sessions.delete(id);
        slot.worker.postMessage({ kind: "dispose", id } satisfies ToWorker);
      },
    };
  }

  async close(): Promise<void> {
    this.closing = true;
    await Promise.all(this.slots.map((s) => s.worker.terminate()));
  }
}
