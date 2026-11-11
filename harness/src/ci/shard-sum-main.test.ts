import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { main } from "./shard-sum";

const report = (name: string, statuses: string[]) => ({
  testResults: [{ name, assertionResults: statuses.map((status) => ({ status })) }],
});

describe("shard sum command line", () => {
  const files = (listed: unknown, reports: unknown[]): string[] => {
    const dir = mkdtempSync(path.join(tmpdir(), "shard-sum-"));
    const write = (name: string, data: unknown): string => {
      const file = path.join(dir, name);
      writeFileSync(file, JSON.stringify(data));
      return file;
    };
    return [write("list.json", listed), ...reports.map((r, i) => write(`r${i}.json`, r))];
  };
  const listed = [{ file: "/w/tests/spec/a.test.ts" }, { file: "/w/tests/spec/a.test.ts" }];

  test("without a list and a report it prints the usage and exits 2", () => {
    const lines: string[] = [];
    expect(main([], (l) => lines.push(l))).toBe(2);
    expect(lines[0]).toContain("usage:");
  });

  test("shards that ran every listed test once print OK and exit 0", () => {
    const lines: string[] = [];
    const argv = files(listed, [report("/r/tests/spec/a.test.ts", ["passed", "passed"])]);
    expect(main(argv, (l) => lines.push(l))).toBe(0);
    expect(lines).toContain("shard report 1: 2 tests");
    expect(lines).toContain("listed 2 tests in 1 files; shards ran 2 in 1 files");
    expect(lines.at(-1)).toContain("OK");
  });

  test("a missing test prints each problem and exits 1", () => {
    const lines: string[] = [];
    const argv = files(listed, [report("/r/tests/spec/a.test.ts", ["passed"])]);
    expect(main(argv, (l) => lines.push(l))).toBe(1);
    expect(lines).toContain("FAIL tests/spec/a.test.ts: listed 2, shards ran 1");
  });
});
