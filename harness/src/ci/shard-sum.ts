/**
 * "Every test, every merge" (ADR-0140): the CI test shards must together run exactly the tests that an
 * unsharded `vitest list` finds, each once, and none may fail or be skipped.
 *   tsx harness/src/ci/shard-sum.ts <list.json> <report.json>...
 * <list.json> is `vitest list --json=<file>`; each <report.json> is one shard's `--reporter=json` output.
 */
import { readFileSync } from "node:fs";
import { isMain } from "../common";

interface ListEntry {
  readonly file: string;
}
interface Assertion {
  readonly status: string;
}
interface Report {
  readonly testResults: ReadonlyArray<{
    readonly name: string;
    readonly assertionResults: Assertion[];
  }>;
}

export interface Tally {
  readonly perFile: Map<string, number>;
  readonly failed: number;
  readonly notRun: number;
}

/** Paths in reports are absolute; compare them relative to the repository. */
const rel = (file: string): string => {
  const marks = ["/packages/", "/apps/", "/harness/", "/tests/"].map((m) => file.indexOf(m));
  const start = marks.filter((i) => i >= 0).sort((a, b) => a - b)[0];
  return start === undefined ? file : file.slice(start + 1);
};

export function countList(entries: readonly ListEntry[]): Map<string, number> {
  const perFile = new Map<string, number>();
  for (const { file } of entries) perFile.set(rel(file), (perFile.get(rel(file)) ?? 0) + 1);
  return perFile;
}

export function tally(reports: readonly Report[]): Tally {
  const perFile = new Map<string, number>();
  let failed = 0;
  let notRun = 0;
  for (const report of reports)
    for (const result of report.testResults) {
      const key = rel(result.name);
      perFile.set(key, (perFile.get(key) ?? 0) + result.assertionResults.length);
      for (const a of result.assertionResults) {
        if (a.status === "failed") failed += 1;
        else if (a.status !== "passed") notRun += 1;
      }
    }
  return { perFile, failed, notRun };
}

const sum = (m: Map<string, number>): number => [...m.values()].reduce((a, b) => a + b, 0);

/** Problems found; empty means every listed test ran exactly once and passed. */
export function compare(listed: Map<string, number>, got: Tally): string[] {
  const problems: string[] = [];
  if (got.failed > 0) problems.push(`${got.failed} test(s) failed`);
  if (got.notRun > 0) problems.push(`${got.notRun} test(s) were skipped, todo or not run`);
  for (const [file, count] of listed)
    if (got.perFile.get(file) !== count)
      problems.push(`${file}: listed ${count}, shards ran ${got.perFile.get(file) ?? 0}`);
  for (const file of got.perFile.keys())
    if (!listed.has(file)) problems.push(`${file}: ran but not listed`);
  return problems;
}

export function main(argv: readonly string[], out: (line: string) => void = console.log): number {
  const [listFile, ...reportFiles] = argv;
  if (!listFile || reportFiles.length === 0) {
    out("usage: shard-sum.ts <list.json> <report.json>...");
    return 2;
  }
  const listed = countList(JSON.parse(readFileSync(listFile, "utf8")) as ListEntry[]);
  const reports = reportFiles.map((f) => JSON.parse(readFileSync(f, "utf8")) as Report);
  for (const [i, r] of reports.entries()) out(`shard report ${i + 1}: ${tallyTotal(r)} tests`);
  const got = tally(reports);
  out(
    `listed ${sum(listed)} tests in ${listed.size} files; shards ran ${sum(got.perFile)} in ${got.perFile.size} files`,
  );
  const problems = compare(listed, got);
  for (const p of problems) out(`FAIL ${p}`);
  if (problems.length === 0) out("OK   every listed test ran exactly once and passed");
  return problems.length === 0 ? 0 : 1;
}

const tallyTotal = (r: Report): number => sum(tally([r]).perFile);

if (isMain(import.meta.url)) process.exit(main(process.argv.slice(2)));
