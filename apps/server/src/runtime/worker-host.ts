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
import type { CallResult, HumanAct, RunResult } from "@terrarium/core/session";
import type { ToolSpec } from "@terrarium/core/tools";
import type { RunEvent } from "@terrarium/core/world";
import { defaultThreadMb, Ledger, PROMISED_SHARE } from "./admission";
import type { HostedSession, PlainSessionConfig, SessionHost } from "./hosts";
import {
  type FromWorker,
  NEED_BLUEPRINT,
  type ToWorker,
  type WorkerError,
} from "./worker-protocol";
import { identityOf } from "./world-cache";

/** Error kinds that keep their type when they cross a thread or a network (see `raise`). */
const ERRORS: Readonly<Record<string, new (message: string) => TerrariumError>> = {
  invalid_value: InvalidValueError,
  not_found: NotFoundError,
  conflict: ConflictError,
  unsupported: UnsupportedError,
};

/** Turn an error sent as data back into the same kind of error it was. */
export const raise = (e: WorkerError): Error => {
  const Kind = e.code ? ERRORS[e.code] : undefined;
  return Kind ? new Kind(e.message) : Object.assign(new Error(e.message), { code: e.code });
};

interface Pending {
  resolve(value: unknown): void;
  reject(err: Error): void;
}

interface Slot {
  worker: Worker;
  /** Its sessions, the worlds it was sent (it may have dropped the oldest since; it says so and gets the blueprint again) and the memory they are promised. */
  readonly ledger: Ledger;
}

/** A thread promised to a session, and whether it still has to be sent the world. */
interface Placed {
  readonly slot: Slot;
  readonly fresh: boolean;
}

/** A session waiting for memory on some thread to free up. */
interface Waiter {
  readonly id: string;
  readonly world: string;
  readonly entities: number;
  readonly resolve: (placed: Placed) => void;
  readonly reject: (err: Error) => void;
  readonly timer: NodeJS.Timeout;
}

/** How long a session may wait for memory before it is told the host is full. */
const DEFAULT_ADMISSION_WAIT_MS = 5 * 60_000;

/** A thread that already holds a session's world is worth this many sessions of extra load (it skips the setup and shares memory). */
const WORLD_AFFINITY = 3;

export interface WorkerHostOptions {
  readonly size: number;
  /**
   * Memory one thread may use, MB (default: this machine's, less the main thread, shared out). Sessions are
   * admitted by it (see admission.ts), and a thread that goes over dies alone (its sessions fail), not the whole process.
   */
  readonly heapMb?: number;
  /** Memory a thread may promise to sessions, MB (default: 70% of what it may use, the rest being room for garbage). */
  readonly promisedMb?: number;
  /** How long a session may wait for memory (default 5 minutes) before it fails with a conflict. */
  readonly admissionWaitMs?: number;
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
  private readonly waiters: Waiter[] = [];
  private readonly threadMb: number;
  private readonly promisedMb: number;
  private seq = 0;
  private nextId = 0;
  private closing = false;

  constructor(private readonly options: WorkerHostOptions) {
    if (options.size < 1) throw new InvalidValueError("워커는 하나 이상이어야 해요");
    const given = options.heapMb ?? Number(process.env.TERRARIUM_WORKER_HEAP_MB);
    this.threadMb = given > 0 ? given : defaultThreadMb(options.size);
    this.promisedMb = options.promisedMb ?? this.threadMb * PROMISED_SHARE;
    for (let i = 0; i < options.size; i++) this.slots.push(this.spawn());
  }

  get openCount(): number {
    return this.owner.size;
  }

  /** Heap each thread uses right now, MB (for the metrics and for capacity measurements). */
  async threadHeapMb(): Promise<number[]> {
    const stats = await Promise.all(this.slots.map((s) => s.worker.getHeapStatistics()));
    return stats.map((h) => Math.round(h.used_heap_size / 1048576));
  }

  /** Sessions on each thread, for the metrics and the placement tests. */
  get threadLoads(): number[] {
    return this.slots.map((s) => s.ledger.count);
  }

  /** Memory promised on each thread, MB, and what each may be promised at most. */
  get threadPromisedMb(): number[] {
    return this.slots.map((s) => Math.round(s.ledger.usedMb));
  }

  /** Sessions waiting for memory. */
  get waiting(): number {
    return this.waiters.length;
  }

  private spawn(): Slot {
    const worker = new Worker(BOOT, {
      eval: true,
      resourceLimits: { maxOldGenerationSizeMb: this.threadMb },
    });
    const slot: Slot = { worker, ledger: new Ledger(this.promisedMb) };
    worker.on("message", (msg: FromWorker) => this.receive(msg));
    worker.on("error", (err) => this.lost(slot, err.message));
    worker.on("exit", (code) => this.lost(slot, `종료 코드 ${code}`));
    return slot;
  }

  /** A worker died: fail what it held and start a replacement. */
  private lost(slot: Slot, why: string): void {
    const index = this.slots.indexOf(slot);
    if (index < 0) return;
    for (const id of this.owner.keys()) {
      if (this.owner.get(id) !== slot) continue;
      this.owner.delete(id);
      for (const [key, p] of this.pending)
        if (key.startsWith(`${id}#`)) {
          this.pending.delete(key);
          p.reject(new Error(`세션을 돌리던 워커가 멈췄어요 (${why})`));
        }
    }
    slot.ledger.clear();
    if (this.closing) {
      this.slots.splice(index, 1);
      return;
    }
    this.slots[index] = this.spawn();
    this.admitWaiting();
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

  /** The thread this world's next session fits on: the least busy, with a head start for those that already hold the world. */
  private placeFor(world: string, entities: number): Slot | undefined {
    const cost = (s: Slot) => s.ledger.count - (s.ledger.has(world) ? WORLD_AFFINITY : 0);
    let best: Slot | undefined;
    for (const s of this.slots) {
      if (!s.ledger.fits(world, entities)) continue;
      if (!best || cost(s) < cost(best)) best = s;
    }
    return best;
  }

  /** A thread with room for the session, promised to it now; if there is none, wait in line for memory to free up. */
  private admit(id: string, world: string, entities: number): Promise<Placed> {
    const slot = this.waiters.length === 0 ? this.placeFor(world, entities) : undefined;
    if (slot) return Promise.resolve({ slot, fresh: slot.ledger.add(id, world, entities) });
    return new Promise<Placed>((resolve, reject) => {
      const timer = setTimeout(() => {
        const at = this.waiters.findIndex((w) => w.id === id);
        if (at >= 0) this.waiters.splice(at, 1);
        reject(
          new ConflictError(
            "서버 메모리가 가득 차서 지금은 실험을 시작할 수 없어요. 돌고 있는 실험이 끝나면 다시 해 주세요.",
          ),
        );
      }, this.options.admissionWaitMs ?? DEFAULT_ADMISSION_WAIT_MS);
      this.waiters.push({ id, world, entities, resolve, reject, timer });
    });
  }

  /** Memory was freed: let the sessions waiting for it in, in the order they came. */
  private admitWaiting(): void {
    for (let next = this.waiters[0]; next; next = this.waiters[0]) {
      const slot = this.placeFor(next.world, next.entities);
      if (!slot) return;
      this.waiters.shift();
      clearTimeout(next.timer);
      next.resolve({ slot, fresh: slot.ledger.add(next.id, next.world, next.entities) });
    }
  }

  /** The session is gone, or never started: give its memory back. */
  private release(id: string, slot: Slot): void {
    slot.ledger.remove(id);
    this.owner.delete(id);
    this.admitWaiting();
  }

  async open(config: PlainSessionConfig): Promise<HostedSession> {
    if (this.closing) throw new ConflictError("서버가 멈추는 중이에요");
    const { blueprint, world, ...slim } = config;
    const identity = world ?? identityOf(blueprint);
    const id = `s${this.nextId++}`;
    const { slot, fresh } = await this.admit(id, identity.key, blueprint.entities.length);
    this.owner.set(id, slot);
    const ask = (withBlueprint: boolean) =>
      this.request<Extract<FromWorker, { kind: "opened" }>>(slot, `${id}#open`, {
        kind: "open",
        id,
        config: slim,
        world: identity,
        ...(withBlueprint ? { blueprint } : {}),
      });
    try {
      // Messages to a thread are handled in order, so once the first open of a world is on its way the
      // ones behind it need not carry the blueprint again (a thread that lost it asks for it).
      const opened = await ask(fresh).catch((err: unknown) => {
        if ((err as { code?: string }).code !== NEED_BLUEPRINT) throw err;
        return ask(true);
      });
      return this.handle(id, opened);
    } catch (err) {
      this.release(id, slot);
      throw err;
    }
  }

  private send<T>(id: string, build: (seq: number) => ToWorker): Promise<T> {
    const slot = this.owner.get(id);
    if (!slot) return Promise.reject(new Error("세션을 돌리던 워커가 멈췄어요"));
    const seq = this.seq++;
    return this.request<T>(slot, `${id}#${seq}`, build(seq));
  }

  private handle(id: string, opened: Extract<FromWorker, { kind: "opened" }>): HostedSession {
    let ended: EndReason | undefined;
    let specs: readonly ToolSpec[] = opened.specs;
    const events: RunEvent[] = [...opened.events];
    const host = this;
    const human = async (op: Extract<ToWorker, { kind: "human" }>["op"]) => {
      const msg = await this.send<Extract<FromWorker, { kind: "humaned" }>>(id, (seq) => ({
        kind: "human",
        id,
        seq,
        op,
      }));
      specs = msg.specs;
      events.push(...msg.events);
      if (msg.result?.ended) ended = msg.result.ended;
      return msg;
    };
    return {
      task: opened.task,
      get specs() {
        return specs;
      },
      humanAct: async (tool, args) => (await human({ kind: "act", tool, args })).act as HumanAct,
      resolveHuman: async (resolution) =>
        (await human({ kind: "resolve", resolution })).result as CallResult,
      get endedBy() {
        return ended ?? host.ended.get(id);
      },
      call: async (tool, args) => {
        const msg = await this.send<{ result: CallResult; events: readonly RunEvent[] }>(
          id,
          (seq) => ({
            kind: "call",
            id,
            seq,
            tool,
            args,
          }),
        );
        if (msg.result.ended) ended = msg.result.ended;
        events.push(...msg.events);
        return msg.result;
      },
      eventsSince: (count) => events.slice(count),
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
        this.ended.delete(id);
        if (!slot) return;
        slot.worker.postMessage({ kind: "dispose", id } satisfies ToWorker);
        this.release(id, slot);
      },
    };
  }

  async close(): Promise<void> {
    this.closing = true;
    for (const w of this.waiters.splice(0)) {
      clearTimeout(w.timer);
      w.reject(new ConflictError("서버가 멈추는 중이에요"));
    }
    await Promise.all(this.slots.map((s) => s.worker.terminate()));
  }
}
