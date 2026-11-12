// Worker thread: owns one WebAssembly instance of terrarium-sh at a time and a hand-written WASI layer.
//
// The WASI layer is deliberately tiny: the only things the module can ask the system for are time (virtual), random
// bytes (fixed), sleeping (moves the virtual clock), and stdout/stderr of a crashing runtime. There are no preopened
// directories, no environment variables and no sockets; every file the shell sees comes through `terrarium.call`.
//
// Protocol with the main thread (shared memory, one word of state):
//   STARTING -> READY (waiting for a job) -> JOB (main posted one) -> REQ (module asks the host something)
//   -> RESP (main answered) -> ... -> RESP of the DONE request, then the worker starts the next instance.
import { workerData } from "node:worker_threads";

const { sab, module: wasmModule, prewarm, hdr = 64 } = workerData;
const ctrl = new Int32Array(sab, 0, 16); // 0 state, 1 op, 2 length, 3 job length
const data = new Uint8Array(sab, hdr);
const S = { STARTING: 0, READY: 1, JOB: 2, REQ: 3, RESP: 4 };
const OP_CRASH = 99;
const EPOCH_NS = BigInt(Date.UTC(2026, 0, 1)) * 1_000_000n;

const MEM_LIMIT = Number(process.env.TERRARIUM_WASM_MEM_MB ?? 256) * 1048576;
class MemoryLimit extends Error {
  constructor() {
    super("memory limit");
  }
}
class ExitSignal {
  constructor(code) {
    this.code = code;
  }
}

const setState = (v) => {
  Atomics.store(ctrl, 0, v);
  Atomics.notify(ctrl, 0);
};
const waitWhile = (v) => {
  while (Atomics.load(ctrl, 0) === v) Atomics.wait(ctrl, 0, v);
};

let pending = new Uint8Array(0);
let curMem;
let realtimeNs = EPOCH_NS;
let monoNs = 0n;
let rng = 0x9e3779b9;
const stderrRaw = [];

function rpc(op, bytes) {
  if (bytes.length > data.length) return -1;
  data.set(bytes, 0);
  if (curMem) ctrl[5] = Math.floor(curMem.buffer.byteLength / 65536); // wasm memory in 64 KiB pages, for measuring
  ctrl[1] = op;
  ctrl[2] = bytes.length;
  setState(S.REQ);
  waitWhile(S.REQ);
  const n = ctrl[2];
  pending = data.slice(0, n);
  return n;
}

function makeImports(getMem) {
  const u8 = () => new Uint8Array(getMem().buffer);
  const dv = () => new DataView(getMem().buffer);
  const wasi = {
    args_sizes_get: (argc, size) => {
      dv().setUint32(argc, 1, true);
      dv().setUint32(size, 13, true);
      return 0;
    },
    args_get: (argv, buf) => {
      dv().setUint32(argv, buf, true);
      u8().set(new TextEncoder().encode("terrarium-sh\0"), buf);
      return 0;
    },
    environ_sizes_get: (count, size) => {
      dv().setUint32(count, 0, true);
      dv().setUint32(size, 0, true);
      return 0;
    },
    environ_get: () => 0,
    clock_time_get: (id, _precision, out) => {
      // the Go runtime reads the clock all the time (scheduler, GC): a cheap place to enforce the memory limit
      if (getMem().buffer.byteLength > MEM_LIMIT) throw new MemoryLimit();
      // every read moves the clock by one microsecond, so loops that wait for time to pass still end
      realtimeNs += 1000n;
      monoNs += 1000n;
      dv().setBigUint64(out, id === 0 ? realtimeNs : monoNs, true);
      return 0;
    },
    random_get: (buf, len) => {
      const a = u8();
      for (let i = 0; i < len; i++) {
        rng ^= rng << 13;
        rng ^= rng >>> 17;
        rng ^= rng << 5;
        a[buf + i] = rng & 0xff;
      }
      return 0;
    },
    sched_yield: () => 0,
    proc_exit: (code) => {
      throw new ExitSignal(code);
    },
    fd_write: (fd, iovs, n, out) => {
      const d = dv();
      const a = u8();
      let total = 0;
      for (let i = 0; i < n; i++) {
        const p = d.getUint32(iovs + i * 8, true);
        const l = d.getUint32(iovs + i * 8 + 4, true);
        if (fd === 2 || fd === 1) stderrRaw.push(Buffer.from(a.slice(p, p + l)));
        total += l;
      }
      d.setUint32(out, total, true);
      return 0;
    },
    fd_read: (_fd, _iovs, _n, out) => {
      dv().setUint32(out, 0, true);
      return 0;
    },
    fd_close: () => 0,
    fd_fdstat_get: (fd, out) => {
      if (fd > 2) return 8; // EBADF
      const d = dv();
      d.setUint8(out, 2); // character device
      d.setUint16(out + 2, 0, true);
      d.setBigUint64(out + 8, 0xffffffffffffffffn, true);
      d.setBigUint64(out + 16, 0xffffffffffffffffn, true);
      return 0;
    },
    fd_fdstat_set_flags: () => 0,
    fd_prestat_get: () => 8,
    fd_prestat_dir_name: () => 8,
    fd_filestat_get: () => 8,
    fd_readdir: () => 8,
    path_filestat_get: () => 44,
    path_open: () => 44,
    path_readlink: () => 44,
    path_remove_directory: () => 44,
    path_unlink_file: () => 44,
    poll_oneoff: (inp, out, nsubs, nevents) => {
      const d = dv();
      let n = 0;
      for (let i = 0; i < nsubs; i++) {
        const base = inp + i * 48;
        const userdata = d.getBigUint64(base, true);
        const tag = d.getUint8(base + 8);
        if (tag === 0) {
          const timeout = d.getBigUint64(base + 24, true);
          const abs = (d.getUint16(base + 40, true) & 1) === 1;
          if (abs) {
            if (timeout > realtimeNs) {
              monoNs += timeout - realtimeNs;
              realtimeNs = timeout;
            }
          } else {
            realtimeNs += timeout;
            monoNs += timeout;
          }
        }
        const o = out + n * 32;
        d.setBigUint64(o, userdata, true);
        d.setUint16(o + 8, 0, true);
        d.setUint8(o + 10, tag);
        n++;
      }
      d.setUint32(nevents, n, true);
      return 0;
    },
  };
  const terrarium = {
    job: () => {
      if (Atomics.load(ctrl, 0) !== S.JOB) {
        setState(S.READY);
        waitWhile(S.READY);
      }
      const len = ctrl[3];
      pending = data.slice(0, len);
      const nowMs = JSON.parse(Buffer.from(pending).toString("utf8")).nowMs;
      if (typeof nowMs === "number") {
        realtimeNs = BigInt(nowMs) * 1_000_000n;
        monoNs = 0n;
      }
      return len;
    },
    call: (op, ptr, n) => rpc(op, u8().slice(ptr, ptr + n)),
    take: (ptr) => {
      u8().set(pending, ptr);
    },
  };
  return { wasi_snapshot_preview1: wasi, terrarium };
}

for (;;) {
  setState(S.STARTING);
  if (!prewarm) {
    setState(S.READY);
    waitWhile(S.READY);
  }
  stderrRaw.length = 0;
  let memory;
  try {
    const inst = new WebAssembly.Instance(wasmModule, makeImports(() => memory));
    memory = inst.exports.memory;
    curMem = memory;
    inst.exports._start();
  } catch (e) {
    if (!(e instanceof ExitSignal)) {
      const msg = `${e instanceof MemoryLimit ? "memory limit" : e && e.stack ? e.stack : e}\n${Buffer.concat(stderrRaw).toString("utf8")}`;
      rpc(OP_CRASH, Buffer.from(msg));
    }
  }
}
