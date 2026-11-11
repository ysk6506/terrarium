/**
 * Golden: the reference solution (정답 풀이, REQ-110) played on every built-in scenario template the `iap` world can host; the score breakdown and the
 * final world state of each run are fingerprinted, seed 1. It protects the scores and the world after a perfect
 * run while the model moves to ports and one propagation engine (ADR-0168, ADR-0169). A total below 100 is as
 * recorded: that template is not made for this world, and the grader's answer there is pinned all the same.
 * An expectation here may change only through the test-lock amend procedure (ADR-0004), with an ADR that
 * explains why the behaviour of an existing world changed. A red test here means exactly that.
 * Read docs/design-docs/golden-safety-net.md first.
 */
import { describe, expect, test } from "vitest";
import { goldenWorld } from "./test-support/golden-matrix";
import { casesOf, recordCases } from "./test-support/golden-scenario";

const EXPECTED: Readonly<Record<string, string>> = {
  "fan-failure-throttle@iap:score": "100 782:0ac429d97c6d9b09",
  "fan-failure-throttle@iap:world": "46909:144c385a8ce87c14",
  "cooling-failure@iap:score": "100 2982:075b075db5d12c05",
  "cooling-failure@iap:world": "46568:07f356fe0711a601",
  "sensor-drift@iap:score": "100 898:0fc78214e19c6202",
  "sensor-drift@iap:world": "46585:024896ec67691218",
  "pdu-breaker-cascade@iap:score": "100 1435:0f56f2a3fe295113",
  "pdu-breaker-cascade@iap:world": "46256:0ebb253e01e4e51d",
  "vm-cpu-spike-escalation@iap:score": "100 1294:0747d17eee2c020b",
  "vm-cpu-spike-escalation@iap:world": "48223:189c9ddf16771701",
  "wrong-vlan-port@iap:score": "65 1125:0ce8f4dd714f710e",
  "wrong-vlan-port@iap:world": "52475:0ca7b40ff2a7df0d",
  "port-shut-by-mistake@iap:score": "65 1160:07e0c66b1be1601b",
  "port-shut-by-mistake@iap:world": "52518:0f681a82a263871b",
  "gateway-interface-shut@iap:score": "100 1290:1bf6de731a0f190f",
  "gateway-interface-shut@iap:world": "50462:02546eb802ff8d00",
  "pdu-outlet-off@iap:score": "100 1113:055470ab26e74309",
  "pdu-outlet-off@iap:world": "46294:028cd3af16f1a30c",
  "firmware-rack@iap:score": "100 2271:06ae5790fff64809",
  "firmware-rack@iap:world": "52355:036fdc6c264b5301",
  "firmware-failure@iap:score": "90 1578:1d4b12f1e7cc3703",
  "firmware-failure@iap:world": "53438:0ef0cd297676cc05",
  "os-disk-full@iap:score": "100 1208:0a7d17e1fa45e309",
  "os-disk-full@iap:world": "47939:0571f341439e8115",
  "os-fs-readonly@iap:score": "100 1212:1c93d93ab51cbb1b",
  "os-fs-readonly@iap:world": "47953:16d2c2819f54f90a",
  "os-ntp-drift@iap:score": "100 1209:08d10bd4e3db1701",
  "os-ntp-drift@iap:world": "49113:0acbad991be01619",
  "db-primary-down@iap:score": "100 1275:0b0ddff4ba1f7407",
  "db-primary-down@iap:world": "48164:0aef4a58d9baca0f",
  "db-replication-broken@iap:score": "100 1554:1ad2a52cd146a510",
  "db-replication-broken@iap:world": "47609:1393e42311455100",
  "db-shared-path-cut@iap:score": "100 1283:075a261e2da22017",
  "db-shared-path-cut@iap:world": "49089:018130b12048d712",
  "k8s-worker-down@iap:score": "100 1169:19e3724af5419b0b",
  "k8s-worker-down@iap:world": "47777:0f326b3e720f2701",
  "k8s-crashloop@iap:score": "100 1445:139764e4a1375200",
  "k8s-crashloop@iap:world": "46291:0865ada9ed33d20c",
  "k8s-etcd-quorum@iap:score": "100 2028:0b2a2bcf0c31451b",
  "k8s-etcd-quorum@iap:world": "47997:17b0395054b05d12",
  "k8s-pending@iap:score": "threw 68:040de1ac6693c709",
  "k8s-pending@iap:world": "-",
  "k8s-disk-pressure@iap:score": "100 1170:18b5a4926c31fc02",
  "k8s-disk-pressure@iap:world": "48449:012f6ef7e04ce304",
};

describe("the reference solution gives the recorded score and world on iap [REQ-110] [REQ-001]", () => {
  test("iap: every template it can host gives the recorded score and final world", () => {
    expect(recordCases(casesOf(goldenWorld("iap")))).toEqual(EXPECTED);
  }, 120_000);
});
