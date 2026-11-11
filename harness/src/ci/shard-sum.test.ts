import { describe, expect, test } from "vitest";
import { compare, countList, tally } from "./shard-sum";

const list = countList([
  { file: "/w/packages/a/src/x.test.ts" },
  { file: "/w/packages/a/src/x.test.ts" },
  { file: "/w/tests/spec/y.test.ts" },
]);
const report = (name: string, statuses: string[]) => ({
  testResults: [{ name, assertionResults: statuses.map((status) => ({ status })) }],
});

describe("shard sum: every test runs exactly once per CI run", () => {
  test("shards that cover the list once pass", () => {
    const got = tally([
      report("/runner/packages/a/src/x.test.ts", ["passed", "passed"]),
      report("/runner/tests/spec/y.test.ts", ["passed"]),
    ]);
    expect(compare(list, got)).toEqual([]);
  });

  test("a file in two shards or in none is reported", () => {
    const twice = tally([
      report("/r/packages/a/src/x.test.ts", ["passed", "passed"]),
      report("/r/packages/a/src/x.test.ts", ["passed", "passed"]),
      report("/r/tests/spec/y.test.ts", ["passed"]),
    ]);
    expect(compare(list, twice)).toEqual(["packages/a/src/x.test.ts: listed 2, shards ran 4"]);
    const missing = tally([report("/r/packages/a/src/x.test.ts", ["passed", "passed"])]);
    expect(compare(list, missing)).toEqual(["tests/spec/y.test.ts: listed 1, shards ran 0"]);
  });

  test("failed and skipped tests are reported", () => {
    const got = tally([
      report("/r/packages/a/src/x.test.ts", ["failed", "skipped"]),
      report("/r/tests/spec/y.test.ts", ["passed"]),
    ]);
    expect(compare(list, got)).toEqual([
      "1 test(s) failed",
      "1 test(s) were skipped, todo or not run",
    ]);
  });
});
