/**
 * Runaway scripts: how long until they stop, why, what the fake machine looks like afterwards, and whether the pool
 * still works. TERRARIUM_SHELL=wasm TERRARIUM_WASM_TIMEOUT_MS=2000 tsx bench/interrupt.ts
 */
import { lab } from "../../../tests/spec/test-support/deep-os-lab";

const { run, world } = lab();
const CASES: Array<[string, string]> = [
  ["tight shell loop", "while :; do :; done"],
  ["loop with a command", "while true; do echo y; done"],
  ["awk busy loop", "awk 'BEGIN{while(1);}'"],
  ["endless output into head", "while true; do echo y; done | head -c 100"],
  ["output flood in a loop (no head)", "for i in {1..400000}; do echo yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy; done"],
  ["cat /dev/zero | head -c 5G", "cat /dev/zero | head -c 5G"],
  ["fork bomb f(){ f|f& };f", "f(){ f|f& };f"],
  ["recursion f(){ f; };f", "f(){ f; };f"],
  ["huge brace expansion", "for i in {1..2000000000}; do :; done"],
  ["memory: a=x; a=$a$a forever", "a=x; while :; do a=$a$a; done"],
  ["awk memory: string doubling", "awk 'BEGIN{a=\"x\"; while(1) a=a a}'"],
  ["partial effects: appends then loops", "while true; do echo y >> /tmp/f; done"],
  ["wait loop on a service that never comes", "until systemctl is-active nosuch >/dev/null; do sleep 1; done"],
];

const events = (): number => world.events().length;
const rows: unknown[] = [];
for (const [name, line] of CASES) {
  const e0 = events();
  const t = performance.now();
  const r = run("srv-a2", line);
  const ms = performance.now() - t;
  const after = run("srv-a2", "echo alive && hostname");
  rows.push({
    name,
    ms: Math.round(ms),
    exit: r.exitCode,
    why: r.stderr.split("\n").filter((l) => l.startsWith("terrarium:") || l.includes("budget")).join(" | ").slice(0, 90),
    outBytes: r.stdout.length,
    worldEvents: events() - e0,
    poolHealthy: after.stdout.startsWith("alive"),
    rssMb: Math.round(process.memoryUsage().rss / 1048576),
  });
}
console.log(JSON.stringify(rows, null, 1));
const f = run("srv-a2", "wc -l < /tmp/f; ls -l /tmp/f").stdout;
console.log("state after the append loop:", f.replace(/\n/g, " / "));
process.exit(0);
