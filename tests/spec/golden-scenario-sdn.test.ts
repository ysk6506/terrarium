/**
 * Golden: the reference solution (정답 풀이, REQ-110) played on every built-in scenario template the `sdn` world can host; the score breakdown and the
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
  "fan-failure-throttle@sdn:score": "100 752:0a2d312006a0211b",
  "fan-failure-throttle@sdn:world": "5757:06fbed2412a95f1e",
  "cooling-failure@sdn:score": "100 1035:137a702222d9d713",
  "cooling-failure@sdn:world": "5264:1ccc34466603590f",
  "sensor-drift@sdn:score": "100 868:0cd839861e046110",
  "sensor-drift@sdn:world": "5261:1034dc83eee29f15",
  "pdu-breaker-cascade@sdn:score": "100 908:02c79c05c43cf609",
  "pdu-breaker-cascade@sdn:world": "5003:014f18fc8185e60d",
  "vm-cpu-spike-escalation@sdn:score": "100 1222:1fd1d91c66ff0b01",
  "vm-cpu-spike-escalation@sdn:world": "5101:1c2789ec5e2e470e",
  "wrong-vlan-port@sdn:score": "100 1059:00ce272ed94bd400",
  "wrong-vlan-port@sdn:world": "5068:1732fd93fda6aa09",
  "port-shut-by-mistake@sdn:score": "100 1066:01e49aa0b93a4112",
  "port-shut-by-mistake@sdn:world": "5003:0caf384e79c65809",
  "gateway-interface-shut@sdn:score": "100 1185:1752ded9012a8d0e",
  "gateway-interface-shut@sdn:world": "5189:1b83d9e9c0859a0f",
  "static-route-removed@sdn:score": "100 1047:18319d17b6fbe710",
  "static-route-removed@sdn:world": "5144:04a59d91cdeb2102",
  "pdu-outlet-off@sdn:score": "100 1025:1a1bc4a02df1d108",
  "pdu-outlet-off@sdn:world": "5006:16c2fdbc4ad74f17",
  "firmware-rack@sdn:score": "100 1294:0d0b00c86f557404",
  "firmware-rack@sdn:world": "5003:020a2c3f83e87b0c",
  "firmware-failure@sdn:score": "100 1273:0e755deb3a476710",
  "firmware-failure@sdn:world": "5127:0ac9ad4b23839011",
  "os-disk-full@sdn:score": "100 1257:1ec3a25a98426d01",
  "os-disk-full@sdn:world": "6702:0414bfa1d6322e10",
  "os-fs-readonly@sdn:score": "100 1263:19872270abd79a10",
  "os-fs-readonly@sdn:world": "6590:04ada94770fa7b00",
  "os-ntp-drift@sdn:score": "100 1259:06994fd290e3ea08",
  "os-ntp-drift@sdn:world": "7865:1d7a17e3dd86e00c",
  "sdn-controller-down@sdn:score": "100 1162:01ff34cebfd61d0e",
  "sdn-controller-down@sdn:world": "5355:0ca038af08ab3002",
  "sdn-sync-failed@sdn:score": "100 1277:1dbd84630479d50f",
  "sdn-sync-failed@sdn:world": "5027:127614e63151b812",
  "sdn-tunnel-down@sdn:score": "100 1730:1acebbe22c56c605",
  "sdn-tunnel-down@sdn:world": "5011:1345baa476dcb51d",
  "netpolicy-wrong-deploy@sdn:score": "100 1262:1fd3bfa49e3d8f0c",
  "netpolicy-wrong-deploy@sdn:world": "5004:12b10c83fb4e6c12",
  "ingress-down@sdn:score": "100 1278:149d0a1d6b423314",
  "ingress-down@sdn:world": "5003:1d6a520cb4b13c05",
  "cni-plugin-failure@sdn:score": "100 1249:12f12fd84b3ea60f",
  "cni-plugin-failure@sdn:world": "6496:00d94fa6fb953b07",
  "domain-memory-vendor@sdn:score": "threw 63:035cb40474aace18",
  "domain-memory-vendor@sdn:world": "-",
};

describe("the reference solution gives the recorded score and world on sdn [REQ-110] [REQ-001]", () => {
  test("sdn: every template it can host gives the recorded score and final world", () => {
    expect(recordCases(casesOf(goldenWorld("sdn")))).toEqual(EXPECTED);
  }, 120_000);
});
