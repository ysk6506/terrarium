/**
 * Synchronous host of the shell module (experiment). `runJob` blocks the calling thread (Atomics.wait) while a worker
 * thread runs the WebAssembly module; whenever the module asks the host something (a file, a command), the caller's
 * thread answers it directly, so the simulated world is only ever touched from the thread that owns it.
 *
 * Why a worker at all: a script that never ends cannot be stopped from inside a single thread. `worker.terminate()`
 * stops even a tight loop in WebAssembly; the pool replaces the worker afterwards.
 */
import { readFileSync } from "node:fs";
import { Worker } from "node:worker_threads";

const S = { STARTING: 0, READY: 1, JOB: 2, REQ: 3, RESP: 4 } as const;
export const OP = { exec: 1, stat: 2, readdir: 3, read: 4, wopen: 5, write: 6, done: 7, crash: 99 } as const;
const HEADER = 64;
const DATA_BYTES = 16 * 1024 * 1024;

export interface JobSpec {
  line: string;
  cwd: string;
  env: string[];
  nowMs: number;
  maxSteps: number;
  maxOut: number;
  awk: "go" | "ts";
  seed: number;
}

export interface Reply {
  hdr: Record<string, unknown>;
  raw?: Uint8Array;
}

/** What answers the module's questions; throws are turned into an I/O error for the module. */
export type Bridge = (op: number, hdr: Record<string, unknown>, raw: Uint8Array) => Reply;

export interface JobResult {
  code: number;
  stdout: Buffer;
  stderr: Buffer;
  /** "steps" | "output" when a budget stopped the script. */
  budget: string;
  /** Set when the wall-clock limit ended it (the worker was terminated). */
  timedOut: boolean;
  crash?: string;
  /** Round trips the module made to the host (for measuring). */
  calls: number;
  /** Linear memory of the module at its last call, in bytes. */
  memBytes: number;
}

interface Slot {
  worker: Worker;
  ctrl: Int32Array;
  data: Uint8Array;
}

export interface EngineOptions {
  workers: number;
  prewarm: boolean;
  timeoutMs: number;
  wasmPath: string;
}

export const defaultOptions = (): EngineOptions => ({
  workers: Number(process.env.TERRARIUM_WASM_WORKERS ?? 2),
  prewarm: process.env.TERRARIUM_WASM_PREWARM !== "0",
  timeoutMs: Number(process.env.TERRARIUM_WASM_TIMEOUT_MS ?? 5000),
  wasmPath:
    process.env.TERRARIUM_WASM_PATH ?? new URL("../bin/terrarium-sh.wasm", import.meta.url).pathname,
});

export class Engine {
  private slots: Slot[] = [];
  private module: WebAssembly.Module | undefined;
  compileMs = 0;

  constructor(readonly opts: EngineOptions = defaultOptions()) {}

  private spawn(): Slot {
    if (!this.module) {
      const t = performance.now();
      this.module = new WebAssembly.Module(readFileSync(this.opts.wasmPath));
      this.compileMs = performance.now() - t;
    }
    const sab = new SharedArrayBuffer(HEADER + DATA_BYTES);
    const worker = new Worker(new URL("./worker.mjs", import.meta.url), {
      workerData: { sab, module: this.module, prewarm: this.opts.prewarm, hdr: HEADER },
    });
    worker.unref();
    return { worker, ctrl: new Int32Array(sab, 0, 16), data: new Uint8Array(sab, HEADER) };
  }

  /** Start the pool without running anything (the first call otherwise pays for it). */
  warm(): void {
    while (this.slots.length < this.opts.workers) this.slots.push(this.spawn());
  }

  private acquire(): Slot {
    this.warm();
    for (;;) {
      for (const s of this.slots) if (Atomics.load(s.ctrl, 0) === S.READY) return s;
      const first = this.slots[0] as Slot;
      Atomics.wait(first.ctrl, 0, Atomics.load(first.ctrl, 0), 1);
    }
  }

  private replace(slot: Slot): void {
    void slot.worker.terminate();
    this.slots[this.slots.indexOf(slot)] = this.spawn();
  }

  /** Stop everything (tests that must leave no thread behind). */
  close(): void {
    for (const s of this.slots) void s.worker.terminate();
    this.slots = [];
  }

  runJob(spec: JobSpec, bridge: Bridge): JobResult {
    const slot = this.acquire();
    const { ctrl, data } = slot;
    const job = Buffer.from(JSON.stringify(spec));
    data.set(job, 0);
    ctrl[3] = job.length;
    Atomics.store(ctrl, 0, S.JOB);
    Atomics.notify(ctrl, 0);

    const started = performance.now();
    const result: JobResult = {
      code: 0,
      stdout: Buffer.alloc(0),
      stderr: Buffer.alloc(0),
      budget: "",
      timedOut: false,
      calls: 0,
      memBytes: 0,
    };
    for (;;) {
      const state = Atomics.load(ctrl, 0);
      if (state !== S.REQ) {
        const left = this.opts.timeoutMs - (performance.now() - started);
        if (left <= 0 || Atomics.wait(ctrl, 0, state, left) === "timed-out") {
          if (Atomics.load(ctrl, 0) === S.REQ) continue;
          result.timedOut = true;
          result.code = 124;
          this.replace(slot);
          return result;
        }
        continue;
      }
      const op = ctrl[1] as number;
      const len = ctrl[2] as number;
      const buf = Buffer.from(data.slice(0, len));
      result.calls++;
      result.memBytes = (ctrl[5] as number) * 65536;
      if (op === OP.crash) {
        result.crash = buf.toString("utf8");
        result.code = 70;
        this.answer(slot, { hdr: {} });
        return result;
      }
      const hlen = buf.readUInt32LE(0);
      const hdr = JSON.parse(buf.subarray(4, 4 + hlen).toString("utf8")) as Record<string, unknown>;
      const raw = buf.subarray(4 + hlen);
      if (op === OP.done) {
        result.code = Number(hdr.code ?? 0);
        result.budget = String(hdr.budget ?? "");
        const outLen = Number(hdr.outLen ?? 0);
        result.stdout = Buffer.from(raw.subarray(0, outLen));
        result.stderr = Buffer.from(raw.subarray(outLen));
        this.answer(slot, { hdr: {} });
        return result;
      }
      let reply: Reply;
      try {
        reply = bridge(op, hdr, raw);
      } catch (e) {
        reply = { hdr: { ok: false, errno: "EIO", message: String(e) } };
      }
      this.answer(slot, reply);
    }
  }

  private answer(slot: Slot, reply: Reply): void {
    const h = Buffer.from(JSON.stringify(reply.hdr));
    const raw = reply.raw ?? new Uint8Array(0);
    const total = 4 + h.length + raw.length;
    if (total > slot.data.length) {
      const e = Buffer.from(JSON.stringify({ ok: false, errno: "EFBIG" }));
      slot.data.set(Buffer.concat([u32(e.length), e]), 0);
      slot.ctrl[2] = 4 + e.length;
    } else {
      slot.data.set(u32(h.length), 0);
      slot.data.set(h, 4);
      slot.data.set(raw, 4 + h.length);
      slot.ctrl[2] = total;
    }
    Atomics.store(slot.ctrl, 0, S.RESP);
    Atomics.notify(slot.ctrl, 0);
  }
}

function u32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
}
