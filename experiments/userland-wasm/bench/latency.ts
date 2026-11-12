/**
 * Latency of `run_command` per line, old shell or wasm shell (decided by TERRARIUM_SHELL), prints one JSON object.
 *   TERRARIUM_SHELL=wasm TERRARIUM_WASM_PREWARM=1 TERRARIUM_WASM_WORKERS=2 tsx bench/latency.ts [runs]
 */
import { lab } from "../../../tests/spec/test-support/deep-os-lab";

const runs = Number(process.argv[2] ?? 200);
/** Time between calls that is not measured: an agent thinks for seconds, so a pool has time to refill. */
const think = Number(process.env.THINK_MS ?? 0);
const pause = (): void => {
  if (think > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, think);
};
const t0 = performance.now();
const { run } = lab();
const labMs = performance.now() - t0;

const LINES: Record<string, string> = {
  simple: "hostname",
  pipeline3: "cat /etc/hosts | grep local | wc -l",
  loop100: "for i in {1..100}; do echo $i; done | wc -l",
  loop100_exec: "for i in {1..100}; do hostname; done | wc -l",
  loop100_old_equivalent: "echo 1 2 3 4 5 6 7 8 9 10 | xargs -n1 echo | wc -l",
  awk: "awk '{print $1}' /etc/hosts",
  awk_pipe: "cat /etc/hosts | awk '{print $1}' | sort | uniq -c",
};

const pct = (xs: number[], p: number): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] as number;
};

const out: Record<string, unknown> = {
  shell: process.env.TERRARIUM_SHELL ?? "old",
  prewarm: process.env.TERRARIUM_WASM_PREWARM ?? "1",
  workers: process.env.TERRARIUM_WASM_WORKERS ?? "2",
  labMs: Math.round(labMs),
  thinkMs: think,
};
const first = performance.now();
run("srv-a2", "hostname");
out.firstCallMs = Math.round(performance.now() - first);

for (const [name, line] of Object.entries(LINES)) {
  const probe = run("srv-a2", line);
  const xs: number[] = [];
  for (let i = 0; i < 5; i++) run("srv-a2", line); // warm-up
  for (let i = 0; i < runs; i++) {
    pause();
    const t = performance.now();
    run("srv-a2", line);
    xs.push(performance.now() - t);
  }
  out[name] = {
    p50: +pct(xs, 50).toFixed(2),
    p95: +pct(xs, 95).toFixed(2),
    max: +Math.max(...xs).toFixed(1),
    n: xs.length,
    code: probe.exitCode,
    sample: probe.output.slice(0, 40),
  };
}
out.rssMb = Math.round(process.memoryUsage().rss / 1048576);
console.log(JSON.stringify(out));
process.exit(0);
