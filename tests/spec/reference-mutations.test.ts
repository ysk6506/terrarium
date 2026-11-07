/**
 * [REQ-110] A wrong variant of the right solution scores less, and the part of the score that drops is the one that
 * names the mistake (ADR-0133). Each variant is the reference path with one thing wrong: no fix at all (the report
 * only), the fix on the wrong thing, the steps in the wrong order, a server turned off on the way, a wrong cause or
 * kind in the report, or the fix started too late. Idle < report only < the reference on every sheet where the agent
 * has something to mend.
 */
import { describe, expect, test } from "vitest";
import { playBuiltin } from "./test-support/baseline-agents";
import { type RefCase, referenceCases } from "./test-support/reference-cases";
import { type Mutation, solve } from "./test-support/reference-solver";

const cases = referenceCases();
const byLabel = (prefix: string) => cases.filter((c) => c.label.startsWith(prefix));

/** Sheets whose whole solution is a diagnosis and a hand-over, or where the cluster mends it: report only is the answer. */
const NOTHING_TO_MEND = [
  "wan-link-cut", // the services run; the line is the network team's
  "geo-replica-broken", // the copy is the storage team's
  "kind-ups_module_fail", // the other UPS carries the load
  "kind-cert_expired", // the cluster reschedules the pod by itself
];
/** Sheets where waiting loses nothing: the system mends them within the window whatever the agent does. */
const SELF_HEALING = [
  "replication-broken", // no service stops: only the copy gets staler, and the sheet prices that at the end
  "k8s-worker-down",
  "nvlink-down",
  "db-managed-storage-full",
  "kind-kernel_panic",
  "kind-dns_failure",
  "region-down",
];

const ids = (r: { score: { items: ReadonlyArray<{ id: string; points: number; max: number }> } }) =>
  r.score.items.filter((i) => i.points < i.max).map((i) => i.id);
const DIAGNOSIS = new Set(["diagnosis", "report"]);

function played(c: RefCase, m?: Mutation) {
  return solve(c.blueprint, c.doc(), m);
}

describe("a wrong cause or a wrong kind in the report loses the report [REQ-110]", () => {
  for (const c of cases) {
    test(c.label, () => {
      for (const kind of ["wrong_root", "wrong_type"] as const) {
        const r = played(c, { kind }).result;
        expect(r.score.total, kind).toBeLessThan(100);
        expect(
          ids(r).some((x) => DIAGNOSIS.has(x)),
          `${kind} drops the report`,
        ).toBe(true);
      }
    }, 60_000);
  }
});

describe("idle < report only < the reference [REQ-110]", () => {
  for (const c of cases) {
    test(c.label, async () => {
      const full = played(c).result.score.total ?? 0;
      const reportOnly = played(c, { kind: "skip_fix" });
      const idle = (await playBuiltin("idle", c.blueprint, c.doc())).result.score.total ?? 0;
      const mended = reportOnly.path.fix.length > 0 && !reportOnly.path.handsOff;
      expect(idle, "idle earns less than the report").toBeLessThan(
        reportOnly.result.score.total ?? 0,
      );
      if (mended && !NOTHING_TO_MEND.some((p) => c.label.startsWith(p))) {
        expect(reportOnly.result.score.total, "the report alone is not the solution").toBeLessThan(
          full,
        );
        expect(
          ids(reportOnly.result).some((x) => !DIAGNOSIS.has(x)),
          "something other than the report drops",
        ).toBe(true);
      } else expect(reportOnly.result.score.total).toBe(full);
    }, 60_000);
  }
});

describe("a fix on the wrong thing is not credited [REQ-110]", () => {
  const SAMPLE = [
    "pdu-breaker-cascade",
    "wrong-vlan-port",
    "firmware-one",
    "os-disk-full",
    "db-primary-down",
    "sdn-sync-failed",
    "netpolicy-wrong-deploy",
    "k8s-crashloop",
    "ib-link-flap",
    "utility-feed-loss",
    "power-cap-rack-limit",
    "kind-dns_failure",
    "db-managed-flapping",
  ];
  for (const label of SAMPLE) {
    test(label, () => {
      const c = byLabel(label)[0] as RefCase;
      const base = played(c);
      const kind = c.blueprint.entities.find((e) => e.id === base.truth.target)?.kind;
      const decoy =
        c.blueprint.entities
          .filter((e) => e.kind === kind && e.id !== base.truth.target)
          .map((e) => e.id)
          .sort()[0] ?? "no-such-entity";
      const r = played(c, { kind: "wrong_target", decoy }).result;
      expect(r.score.total).toBeLessThan(100);
      expect(
        ids(r).some((x) => !DIAGNOSIS.has(x)),
        "the mending or the safety drops",
      ).toBe(true);
    }, 60_000);
  }
});

describe("steps in the wrong order are not credited [REQ-110]", () => {
  const ORDERED = [
    "sdn-tunnel-down",
    "k8s-etcd-quorum",
    "mesh-control-stuck",
    "domain-memory-vendor",
    "domain-port-network",
    "site-power-loss [cold]",
    "dr-failover-stuck",
    "gpu-xid-error",
    "scheduler-down-job",
    "kind-switch_failure",
    "kind-nfv_firewall_overload",
    "kind-gpu_thermal_throttle",
  ];
  for (const label of ORDERED) {
    test(label, () => {
      const c = byLabel(label)[0] as RefCase;
      expect(played(c, { kind: "reverse_fix" }).result.score.total).toBeLessThan(100);
    }, 60_000);
  }
});

/** Sheets whose own solution turns servers off or whose service is moved by the system, so a server off is no worsening. */
const POWER_OFF_IS_FINE = [
  "vm-cpu-spike-escalation", // the fix is to stop what runs on the server
  "plant-loop-down", // the room is hot: turning servers off is the protection
  "cdu-failure", // shedding load is the solution
  "outage-generator-fails", // shedding load is the solution
  "firmware-one", // the standby takes the service over
  "domain-port-network", // the keep-alive moves have already put the service elsewhere
];

describe("turning off the server that carries the service is a worsening [REQ-110]", () => {
  // in a hall of replicas one server off is absorbed by the others and is no worsening: the small worlds carry the proof
  const small = cases.filter(
    (c) => c.blueprint.entities.filter((e) => e.kind === "server").length <= 12,
  );
  test("the small worlds are most of the layers", () => {
    expect(small.length).toBeGreaterThanOrEqual(60);
  });
  for (const c of small.filter((x) => !POWER_OFF_IS_FINE.some((p) => x.label.startsWith(p)))) {
    test(c.label, () => {
      const r = played(c, { kind: "worsen", victim: "" }).result;
      expect(r.score.total).toBeLessThan(100);
      const penalised = (r.score.penalty ?? 0) > 0;
      expect(
        penalised || ids(r).some((x) => !DIAGNOSIS.has(x)),
        "the safety or a penalty shows it",
      ).toBe(true);
    }, 60_000);
  }
});

describe("the right fix, started late, is paid less [REQ-110]", () => {
  for (const c of cases) {
    test(c.label, () => {
      const base = played(c);
      const recovery = base.result.score.recovery !== undefined;
      const fix = base.path.fix.length > 0 && !base.path.handsOff;
      if (
        !recovery ||
        !fix ||
        SELF_HEALING.some((p) => c.label.startsWith(p)) ||
        NOTHING_TO_MEND.some((p) => c.label.startsWith(p))
      )
        return;
      const expected = c.doc().expectedRecoveryS ?? 300;
      // a window of hours or days (a team's visit) does not notice a delay of minutes: nothing to prove there
      if (expected > 3600) return;
      const seconds = 3 * expected;
      const r = played(c, { kind: "too_slow", seconds }).result;
      expect(r.score.total).toBeLessThan(100);
      expect(
        ids(r).some((x) => x === "recovery_time" || x === "recovery_order"),
        "time or order drops",
      ).toBe(true);
    }, 60_000);
  }
});
