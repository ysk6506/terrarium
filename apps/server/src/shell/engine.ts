/**
 * The shell engine of the simulated machines: mvdan/sh and goawk compiled to WebAssembly (apps/server/shell-wasm),
 * run in worker threads (ADR-0196, ADR-0200). It implements the core's `ShellEngine` port and nothing else; what it can
 * open is the three functions of `ShellHostPort`'s ops, answered here from the world.
 *
 * `run` blocks the calling thread (`Atomics.wait`) while a worker thread runs the module, and whenever the module asks
 * the host something (a file, a command, the time), the caller's own thread answers it, so the world is only ever
 * touched from the thread that owns it. Why a worker at all: a script that never ends cannot be stopped from inside a
 * single thread; `worker.terminate()` stops even a tight loop in WebAssembly. That is the safety net (wall clock):
 * the limits that decide results are counted inside the module and do not depend on it.
 */
import { readFileSync } from "node:fs";
import { Worker } from "node:worker_threads";
import type {
  ShellEngine,
  ShellEngineResult,
  ShellFileStat,
  ShellHostPort,
  ShellJob,
  ShellLimitKind,
} from "@terrarium/core/world";

const S = { STARTING: 0, READY: 1, JOB: 2, REQ: 3, RESP: 4 } as const;
const OP = {
  exec: 1,
  stat: 2,
  readdir: 3,
  read: 4,
  wopen: 5,
  write: 6,
  done: 7,
  gap: 8,
  crash: 99,
} as const;
const HEADER = 64;
const DATA_BYTES = 16 * 1024 * 1024;
const WASM = new URL("../../shell-wasm/bin/terrarium-sh.wasm", import.meta.url);
const WORKER = new URL("./worker.mjs", import.meta.url);

export interface WasmShellOptions {
  /** Workers kept ready (default 1: the next instance is made while the caller thinks). */
  readonly workers?: number;
  /** Make the next instance before the next call (default true; false: a fresh instance per call). */
  readonly prewarm?: boolean;
  /** The safety net: a line still running after this many milliseconds is stopped (default 10 s). */
  readonly wallClockMs?: number;
  /** The guard against a runaway module: bytes of linear memory at which the instance is dropped (default 512 MB). */
  readonly hardMemoryBytes?: number;
}

interface Slot {
  readonly worker: Worker;
  readonly ctrl: Int32Array;
  readonly data: Uint8Array;
}

interface Reply {
  readonly hdr: Record<string, unknown>;
  readonly raw?: Uint8Array;
}

const enc = new TextEncoder();
const dec = new TextDecoder();
const u32 = (n: number): Uint8Array => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return b;
};

const entry = (s: ShellFileStat): Record<string, unknown> => ({
  ok: true,
  type: s.type,
  mode: s.mode,
  size: s.size,
  mtime: s.mtime,
  name: s.name,
});
const failed = (errno: string): Reply => ({ hdr: { ok: false, errno } });

export class WasmShellEngine implements ShellEngine {
  private slots: Slot[] = [];
  private module: WebAssembly.Module | undefined;
  private readonly opts: Required<WasmShellOptions>;

  constructor(opts: WasmShellOptions = {}) {
    this.opts = {
      workers: opts.workers ?? 1,
      prewarm: opts.prewarm ?? true,
      wallClockMs: opts.wallClockMs ?? 10_000,
      hardMemoryBytes: opts.hardMemoryBytes ?? 512 * 1024 * 1024,
    };
  }

  private spawn(): Slot {
    this.module ??= new WebAssembly.Module(readFileSync(WASM));
    const sab = new SharedArrayBuffer(HEADER + DATA_BYTES);
    const worker = new Worker(WORKER, {
      workerData: {
        sab,
        module: this.module,
        prewarm: this.opts.prewarm,
        hdr: HEADER,
        hardMemoryBytes: this.opts.hardMemoryBytes,
      },
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

  /** Stop every worker (tests that must leave no thread behind). */
  close(): void {
    for (const s of this.slots) void s.worker.terminate();
    this.slots = [];
  }

  run(job: ShellJob, host: ShellHostPort): ShellEngineResult {
    const slot = this.acquire();
    const { ctrl, data } = slot;
    const bytes = enc.encode(JSON.stringify(job));
    data.set(bytes, 0);
    ctrl[3] = bytes.length;
    Atomics.store(ctrl, 0, S.JOB);
    Atomics.notify(ctrl, 0);
    const started = performance.now();
    try {
      for (;;) {
        const state = Atomics.load(ctrl, 0);
        if (state !== S.REQ) {
          const left = this.opts.wallClockMs - (performance.now() - started);
          if (left <= 0 || Atomics.wait(ctrl, 0, state, left) === "timed-out") {
            if (Atomics.load(ctrl, 0) === S.REQ) continue;
            this.replace(slot);
            return this.stopped("wall");
          }
          continue;
        }
        const op = ctrl[1] as number;
        const buf = data.slice(0, ctrl[2] as number);
        if (op === OP.crash) {
          this.answer(slot, { hdr: {} });
          return {
            code: 70,
            stdout: new Uint8Array(0),
            stderr: new Uint8Array(0),
            crash: dec.decode(buf),
          };
        }
        const hlen = new DataView(buf.buffer, buf.byteOffset).getUint32(0, true);
        const hdr = JSON.parse(dec.decode(buf.subarray(4, 4 + hlen))) as Record<string, unknown>;
        const raw = buf.subarray(4 + hlen);
        host.advanceTo(Number(hdr.t ?? 0));
        if (op === OP.done) {
          this.answer(slot, { hdr: {} });
          return this.finished(hdr, raw);
        }
        const reply = this.serve(host, op, hdr, raw);
        this.answer(slot, {
          hdr: { ...reply.hdr, seq: host.stamp() },
          ...(reply.raw ? { raw: reply.raw } : {}),
        });
      }
    } catch (e) {
      // the host failed while the module waits for its answer: the instance cannot go on
      this.replace(slot);
      throw e;
    }
  }

  private stopped(limit: ShellLimitKind): ShellEngineResult {
    return { code: 124, stdout: new Uint8Array(0), stderr: new Uint8Array(0), limit };
  }

  private finished(hdr: Record<string, unknown>, raw: Uint8Array): ShellEngineResult {
    const outLen = Number(hdr.outLen ?? 0);
    const limit = String(hdr.limit ?? "");
    return {
      code: Number(hdr.code ?? 0),
      stdout: raw.slice(0, outLen),
      stderr: raw.slice(outLen),
      ...(limit ? { limit: limit as ShellLimitKind } : {}),
      use: {
        steps: Number(hdr.steps ?? 0),
        outputBytes: Number(hdr.out ?? 0),
        heapBytes: Number(hdr.heap ?? 0),
        worldSeconds: Number(hdr.t ?? 0),
      },
    };
  }

  /** What the world answers to one question of the module. */
  private serve(
    host: ShellHostPort,
    op: number,
    hdr: Record<string, unknown>,
    raw: Uint8Array,
  ): Reply {
    const path = String(hdr.path ?? "");
    switch (op) {
      case OP.exec: {
        const r = host.exec(
          hdr.argv as string[],
          String(hdr.cwd),
          (hdr.env as string[] | undefined) ?? [],
          raw,
        );
        const out = new Uint8Array(r.stdout.length + r.stderr.length);
        out.set(r.stdout, 0);
        out.set(r.stderr, r.stdout.length);
        return { hdr: { code: r.code, outLen: r.stdout.length }, raw: out };
      }
      case OP.stat: {
        const s = host.stat(path, hdr.follow === true);
        return "errno" in s ? failed(s.errno) : { hdr: entry(s) };
      }
      case OP.readdir: {
        const list = host.readDir(path);
        return "errno" in list
          ? failed(list.errno)
          : { hdr: { ok: true, entries: list.map(entry) } };
      }
      case OP.read: {
        const r = host.read(path);
        return "errno" in r ? failed(r.errno) : { hdr: { ok: true }, raw: r };
      }
      case OP.wopen: {
        const e = host.mayWrite(path, hdr.append === true);
        return e ? failed(e.errno) : { hdr: { ok: true } };
      }
      case OP.write: {
        const e = host.write(path, raw, hdr.append === true);
        return e ? failed(e.errno) : { hdr: { ok: true } };
      }
      case OP.gap:
        return { hdr: { text: host.gap(String(hdr.tool), String(hdr.feature), String(hdr.what)) } };
      default:
        return failed("ENOSYS");
    }
  }

  private answer(slot: Slot, reply: Reply): void {
    const h = enc.encode(JSON.stringify(reply.hdr));
    const raw = reply.raw ?? new Uint8Array(0);
    const total = 4 + h.length + raw.length;
    if (total > slot.data.length) {
      const e = enc.encode(JSON.stringify({ ok: false, errno: "EFBIG" }));
      slot.data.set(u32(e.length), 0);
      slot.data.set(e, 4);
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
