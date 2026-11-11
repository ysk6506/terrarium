/**
 * Golden: the reference solution (정답 풀이, REQ-110) played on every built-in scenario template the `train` world can host; the score breakdown and the
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
  "fan-failure-throttle@train:score": "100 782:0ac429d97c6d9b09",
  "fan-failure-throttle@train:world": "73703:1cb26e9d3f796610",
  "cooling-failure@train:score": "100 3794:10334e0a6c3f2218",
  "cooling-failure@train:world": "73023:02bd9ad407e6cf11",
  "sensor-drift@train:score": "100 898:0fc78214e19c6202",
  "sensor-drift@train:world": "73075:1fc7be9197f9c804",
  "pdu-breaker-cascade@train:score": "100 1435:0f56f2a3fe295113",
  "pdu-breaker-cascade@train:world": "72746:0d750a01edb4b01b",
  "vm-cpu-spike-escalation@train:score": "100 1378:15ad92e1bb414a0b",
  "vm-cpu-spike-escalation@train:world": "73192:0cd8d4ad9f3b9217",
  "wrong-vlan-port@train:score": "100 1139:1bcad61b67e96e07",
  "wrong-vlan-port@train:world": "72801:0cac253d3249740f",
  "port-shut-by-mistake@train:score": "100 1174:1e2038531e97de0a",
  "port-shut-by-mistake@train:world": "72720:0545be870b12d514",
  "gateway-interface-shut@train:score": "100 1290:1bf6de731a0f190f",
  "gateway-interface-shut@train:world": "72947:0dede972e4aea015",
  "pdu-outlet-off@train:score": "100 1113:055470ab26e74309",
  "pdu-outlet-off@train:world": "72719:0581801c7089b715",
  "firmware-one@train:score": "100 2625:0a25bd7a59b78717",
  "firmware-one@train:world": "72937:010b0f5f1ce79c0c",
  "firmware-rack@train:score": "100 2271:0ec26aa72f227900",
  "firmware-rack@train:world": "72735:00ca46c87129ed0e",
  "firmware-failure@train:score": "100 1582:1e9a9d1e9119ce08",
  "firmware-failure@train:world": "72862:04d94f1df02cda1d",
  "os-disk-full@train:score": "100 1354:0da31f32b68a700f",
  "os-disk-full@train:world": "74380:11adfaa62dd6570d",
  "os-fs-readonly@train:score": "100 1358:055edc4d1913e112",
  "os-fs-readonly@train:world": "74240:066789abf6ec8819",
  "os-ntp-drift@train:score": "100 1356:16c4d28ad947ef17",
  "os-ntp-drift@train:world": "75429:0a40e369e098d518",
  "db-shared-path-cut@train:score": "100 1294:098961fcf19d6509",
  "db-shared-path-cut@train:world": "74278:07e0b66045e37507",
  "db-restore-corrupt-backup@train:score": "100 1184:17e90385b5a5d914",
  "db-restore-corrupt-backup@train:world": "74050:10a47ffe62505e0f",
  "gpu-xid-error@train:score": "100 1315:1e9f93e477e24d08",
  "gpu-xid-error@train:world": "72917:1e7bc80312d8cb1a",
  "nvlink-down@train:score": "100 1314:09566763d49b2106",
  "nvlink-down@train:world": "73317:021da4028a9c1305",
  "ib-link-flap@train:score": "100 1314:0f6dcc32b6228d15",
  "ib-link-flap@train:world": "73321:0a2cf894fcf5e108",
  "job-stuck-checkpoint@train:score": "100 1273:18e8e9e2255ac317",
  "job-stuck-checkpoint@train:world": "72835:1dc46b512e7a6213",
  "scheduler-down-job@train:score": "100 1296:01bbf1ad40d99819",
  "scheduler-down-job@train:world": "74222:0ff1ca77c1e2b805",
  "power-cap-rack-limit@train:score": "100 1125:039674f595049507",
  "power-cap-rack-limit@train:world": "85928:11647e15e2026006",
  "power-cap-cooling-short@train:score": "100 1141:13e647b1b864ed05",
  "power-cap-cooling-short@train:world": "111422:05fea5c3081ef613",
};

describe("the reference solution gives the recorded score and world on train [REQ-110] [REQ-001]", () => {
  test("train: every template it can host gives the recorded score and final world", () => {
    expect(recordCases(casesOf(goldenWorld("train")))).toEqual(EXPECTED);
  }, 120_000);
});
