/**
 * Cost of one host round trip and of module start, with a bridge that answers instantly (no Terrarium code involved).
 *   tsx bench/roundtrip.ts
 */
import { Engine, OP, type JobSpec, type Reply } from "../host/engine";

const stat: Reply = { hdr: { ok: true, type: "f", mode: 420, size: 1, mtime: 1.7e9, name: "x" } };
const bridge = (op: number): Reply => {
  if (op === OP.stat) return stat;
  if (op === OP.exec) return { hdr: { code: 0, outLen: 0 } };
  if (op === OP.read) return { hdr: { ok: true }, raw: Buffer.alloc(1 << 20, 97) };
  return { hdr: { ok: true } };
};
const spec = (line: string): JobSpec => ({
  line,
  cwd: "/",
  env: ["HOME=/"],
  nowMs: 1.7e12,
  maxSteps: 0,
  maxOut: 0,
  awk: "go",
  seed: 1,
});

const t0 = performance.now();
const engine = new Engine();
engine.warm();
const first = engine.runJob(spec("true"), bridge);
const firstMs = performance.now() - t0;
const timeOf = (line: string, reps = 5): { ms: number; calls: number } => {
  const xs: number[] = [];
  let calls = 0;
  for (let i = 0; i < reps; i++) {
    const t = performance.now();
    calls = engine.runJob(spec(line), bridge).calls;
    xs.push(performance.now() - t);
  }
  xs.sort((a, b) => a - b);
  return { ms: xs[Math.floor(reps / 2)] as number, calls };
};
const N = 5000;
const a = timeOf(`for i in {1..${N}}; do :; done`);
const b = timeOf(`for i in {1..${N}}; do [ -e /etc/hosts ]; done`);
const c = timeOf(`for i in {1..${N}}; do hostname; done`);
const d = timeOf("cat < /big | wc -c; cat < /big | wc -c; cat < /big | wc -c; cat < /big | wc -c");
console.log(
  JSON.stringify(
    {
      compileMs: +engine.compileMs.toFixed(0),
      firstCallIncludingPoolStartMs: +firstMs.toFixed(0),
      firstCalls: first.calls,
      iterations: N,
      loopNoHostCallMs: +a.ms.toFixed(1),
      loopStatMs: +b.ms.toFixed(1),
      loopExecMs: +c.ms.toFixed(1),
      perStatRoundTripUs: +(((b.ms - a.ms) / N) * 1000).toFixed(1),
      perExecRoundTripUs: +(((c.ms - a.ms) / N) * 1000).toFixed(1),
      read4x1MiBms: +d.ms.toFixed(1),
    },
    null,
    1,
  ),
);
process.exit(0);
