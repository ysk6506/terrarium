import { describe, expect, test } from "vitest";
import { journeys } from "./run";

describe("the journey runner passes a failed step's evidence to the log [REQ-041]", () => {
  test("lines that start with 'evidence: ' are printed beside the verdict, other output is not", async () => {
    const out: string[] = [];
    const code = await journeys(
      process.cwd(),
      {},
      (l) => void out.push(l),
      async () => ({
        code: 1,
        output: "evidence: ---- journey run failed: x\nnoise\njourneys: 못 끝낸 여정 run\n",
      }),
    );
    expect(code).toBe(1);
    expect(out).toEqual(["evidence: ---- journey run failed: x", "journeys: 못 끝낸 여정 run"]);
  });
});
