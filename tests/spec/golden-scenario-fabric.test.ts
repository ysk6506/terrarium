/**
 * Golden: the reference solution (정답 풀이, REQ-110) played on every built-in scenario template the `fabric` world can host; the score breakdown and the
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
  "fan-failure-throttle@fabric:score": "100 752:0a2d312006a0211b",
  "fan-failure-throttle@fabric:world": "5566:0485e407b1fa6619",
  "cooling-failure@fabric:score": "100 1035:137a702222d9d713",
  "cooling-failure@fabric:world": "5335:0c132cd0df3c2a13",
  "sensor-drift@fabric:score": "100 868:0cd839861e046110",
  "sensor-drift@fabric:world": "5330:02984ebc2efdc91b",
  "pdu-breaker-cascade@fabric:score": "100 908:02c79c05c43cf609",
  "pdu-breaker-cascade@fabric:world": "5071:095cc2664cfbba19",
  "vm-cpu-spike-escalation@fabric:score": "100 1222:1fd1d91c66ff0b01",
  "vm-cpu-spike-escalation@fabric:world": "5170:028b3f65f158ce19",
  "bgp-neighbor-shut@fabric:score": "100 1069:12d3fda1a3d7711c",
  "bgp-neighbor-shut@fabric:world": "5089:1c848e4e22bda102",
  "gpu-rail-port-shut@fabric:score": "100 1065:18ca4040a04a9a16",
  "gpu-rail-port-shut@fabric:world": "5066:1e4e1ac0c0d17b0a",
  "pdu-outlet-off@fabric:score": "100 1025:1a1bc4a02df1d108",
  "pdu-outlet-off@fabric:world": "5064:1c119e40a5655c12",
  "firmware-one@fabric:score": "100 1167:07bcbb464e290a08",
  "firmware-one@fabric:world": "5072:1aee056f26dd8f10",
  "firmware-rack@fabric:score": "100 1294:0d0b00c86f557404",
  "firmware-rack@fabric:world": "5069:197fa65cc9c14118",
  "firmware-failure@fabric:score": "100 1272:11987988bb37e817",
  "firmware-failure@fabric:world": "5185:0543e020c0f2e015",
};

describe("the reference solution gives the recorded score and world on fabric [REQ-110] [REQ-001]", () => {
  test("fabric: every template it can host gives the recorded score and final world", () => {
    expect(recordCases(casesOf(goldenWorld("fabric")))).toEqual(EXPECTED);
  }, 120_000);
});
