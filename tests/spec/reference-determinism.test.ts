/**
 * [REQ-110] The same scenario, seed and actions give a byte-identical score breakdown (ADR-0133). Recovery is timed on
 * the simulated clock (a tool call costs thirty simulated seconds, a `wait` its seconds), so how long a model thinks or
 * how slow the harness is cannot move a score. Three runs of a representative sheet of every layer, with and without
 * real delay between the calls, must print the same JSON.
 */
import { describe, expect, test } from "vitest";
import { referenceCases } from "./test-support/reference-cases";
import { solve } from "./test-support/reference-solver";

/** One sheet of each layer, a hand-off, a self-healing cluster and a hot site. */
const SAMPLE = [
  "fan-failure-throttle",
  "wrong-vlan-port",
  "firmware-rack",
  "os-disk-full",
  "db-primary-down [replicated]",
  "sdn-tunnel-down [sdn]",
  "k8s-worker-down [k8s]",
  "retry-storm [mesh]",
  "site-power-loss [hot]",
  "dr-failover-stuck [warm]",
  "gpu-xid-error [train]",
  "utility-feed-loss [power]",
  "power-cap-rack-limit",
  "kind-switch_failure [campus]",
];

const wallDelay = (ms: number) => () => {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    /* the harness is slow: real time passes, simulated time must not */
  }
};

describe("a score is a function of the scenario, the seed and the actions [REQ-110]", () => {
  for (const label of SAMPLE) {
    test(label, () => {
      const c = referenceCases().find((x) => x.label === label);
      if (!c) throw new Error(`no sheet ${label}`);
      const runs = [0, 1, 2].map((i) => {
        const r = solve(c.blueprint, c.doc(), undefined, 1, i === 2 ? wallDelay(15) : undefined);
        return JSON.stringify({
          score: r.result.score,
          calls: r.calls.map((x) => [x.name, x.args]),
        });
      });
      expect(runs[1]).toBe(runs[0]);
      expect(runs[2], "real delay between the calls changes nothing").toBe(runs[0]);
    }, 60_000);
  }

  test("the same actions on a different seed on a sheet with no chance in it give the same score", () => {
    const c = referenceCases().find((x) => x.label === "os-disk-full");
    if (!c) throw new Error("no sheet");
    const a = solve(c.blueprint, c.doc(), undefined, 1).result.score;
    const b = solve(c.blueprint, c.doc(), undefined, 7).result.score;
    expect(b.total).toBe(a.total);
  });
});
