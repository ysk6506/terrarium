/**
 * Resident memory per shell instance: RSS of the process with 0, 1, 2, 4, 8 workers, each holding a started instance,
 * and the linear memory of the module after jobs of different weight. Run with --expose-gc for steadier numbers.
 */
import { Engine, OP, defaultOptions, type JobSpec, type Reply } from "../host/engine";

const bridge = (op: number): Reply => {
  if (op === OP.exec) return { hdr: { code: 0, outLen: 0 } };
  if (op === OP.read) return { hdr: { ok: true }, raw: Buffer.alloc(8 << 20, 97) };
  return { hdr: { ok: true, type: "f", mode: 420, size: 1, mtime: 1, name: "x" } };
};
const spec = (line: string): JobSpec => ({
  line, cwd: "/", env: ["HOME=/"], nowMs: 1.7e12, maxSteps: 0, maxOut: 0, awk: "go", seed: 1,
});
const rss = (): number => Math.round(process.memoryUsage().rss / 1048576);
const sleepMs = (ms: number): void => void Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

const out: Record<string, unknown> = { rssBeforeMb: rss() };
const rows: unknown[] = [];
let prev: Engine | undefined;
for (const n of [1, 2, 4, 8]) {
  prev?.close();
  sleepMs(300);
  const base = rss();
  const e = new Engine({ ...defaultOptions(), workers: n });
  e.warm();
  for (let i = 0; i < n * 2; i++) e.runJob(spec("true"), bridge); // every instance has run once
  sleepMs(1500); // let the replacement instances start
  rows.push({ workers: n, rssMb: rss(), deltaMb: rss() - base, perWorkerMb: +((rss() - base) / n).toFixed(1) });
  prev = e;
}
out.byWorkers = rows;

const e = prev as Engine;
const mem = (line: string): number => e.runJob(spec(line), bridge).memBytes / 1048576;
out.wasmLinearMemoryMb = {
  trivial: mem("true"),
  loop100: mem("for i in {1..100}; do echo $i; done | wc -l"),
  read8MiB: mem("cat < /big | wc -c"),
  stringDoubling18: mem("a=x; for i in {1..24}; do a=$a$a; done; echo ${#a}"),
  awkBigArray: mem("awk 'BEGIN{for(i=0;i<300000;i++) a[i]=i; print length(a)}'"),
};
console.log(JSON.stringify(out, null, 1));
process.exit(0);
