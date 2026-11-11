/**
 * Golden: the reference solution (정답 풀이, REQ-110) played on the templates no matrix world can host, each in the world the reference tests give it; the score breakdown and the
 * final world state of each run are fingerprinted, seed 1. It protects the scores and the world after a perfect
 * run while the model moves to ports and one propagation engine (ADR-0168, ADR-0169). A total below 100 is as
 * recorded: that template is not made for this world, and the grader's answer there is pinned all the same.
 * An expectation here may change only through the test-lock amend procedure (ADR-0004), with an ADR that
 * explains why the behaviour of an existing world changed. A red test here means exactly that.
 * Read docs/design-docs/golden-safety-net.md first.
 */
import { describe, expect, test } from "vitest";
import { extraCases, recordCases } from "./test-support/golden-scenario";

const EXPECTED: Readonly<Record<string, string>> = {
  "sidecar-crash@extra:score": "100 1319:0faed6bf5624d610",
  "sidecar-crash@extra:world": "11219:0288dac073375204",
  "split-brain@extra:score": "100 1265:069d1c7e95b55f1c",
  "split-brain@extra:world": "70814:12129a278aabed18",
  "gpu-memory-leak@extra:score": "100 1330:035d054b01f8af01",
  "gpu-memory-leak@extra:world": "60738:0492c2245ebc2701",
  "mig-misconfig@extra:score": "100 1255:04f8a7102b889200",
  "mig-misconfig@extra:world": "60748:1778bf30c160ec14",
  "utility-feed-loss@extra:score": "100 810:0c674626d5452b1b",
  "utility-feed-loss@extra:world": "40864:0479293f9528d108",
  "cdu-pump-fail@extra:score": "100 1303:1c6d1e97a4a3ba0a",
  "cdu-pump-fail@extra:world": "74173:10648a29f140660f",
};

describe("the reference solution gives the recorded score and world on extra [REQ-110] [REQ-001]", () => {
  test("extra: every template it can host gives the recorded score and final world", () => {
    expect(recordCases(extraCases())).toEqual(EXPECTED);
  }, 120_000);
});
