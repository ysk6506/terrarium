/**
 * Prints, per architecture unit that is under its coverage floor (or every unit with --all), the files with the most
 * uncovered statements and branches and the line numbers of the gaps. Reads coverage/coverage-final.json (the `json`
 * reporter of `vitest --coverage`). Used by the coverage-floors CI job so the log says what to test.
 *
 *   pnpm tsx scripts/coverage-gaps.ts [--all] [--unit core.world] [--files <substring>]
 *
 * `--files` lists every file whose path contains the text, whatever its unit's floor (to see the gaps of one directory).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { loadArchConfig, unitOf } from "../harness/src/checks/arch-model";
import { loadFloors } from "../harness/src/checks/coverage";
import { loadTestsConfig } from "../harness/src/checks/testguard";

interface Loc {
  start: { line: number };
  end: { line: number };
}
interface FileCov {
  path: string;
  statementMap: Record<string, Loc>;
  s: Record<string, number>;
  branchMap: Record<string, { locations: Loc[] }>;
  b: Record<string, number[]>;
}

const say = (line: string): void => void process.stdout.write(`${line}\n`);
const root = process.cwd();
const argv = process.argv.slice(2);
const all = argv.includes("--all");
const only = argv.includes("--unit") ? argv[argv.indexOf("--unit") + 1] : undefined;
const files = argv.includes("--files") ? argv[argv.indexOf("--files") + 1] : undefined;
/** 3,4,5,9 -> "3-5,9" */
const ranges = (xs: readonly number[]): string => {
  const out: string[] = [];
  for (let i = 0; i < xs.length; i++) {
    let j = i;
    while (xs[j + 1] === (xs[j] as number) + 1) j++;
    out.push(j === i ? `${xs[i]}` : `${xs[i]}-${xs[j]}`);
    i = j;
  }
  return out.join(",");
};
const cov = JSON.parse(
  readFileSync(path.join(root, "coverage/coverage-final.json"), "utf8"),
) as Record<string, FileCov>;
const arch = loadArchConfig(root);
const floors = loadFloors(root, loadTestsConfig(root));

interface Row {
  file: string;
  total: number;
  hit: number;
  lines: number[];
  branchLines: number[];
}
const units = new Map<string, Row[]>();
for (const [abs, f] of Object.entries(cov)) {
  const rel = path.relative(root, abs);
  const unit = unitOf(arch, rel);
  if (!unit) continue;
  const lines = new Set<number>();
  let total = 0;
  let hit = 0;
  for (const [id, n] of Object.entries(f.s)) {
    total++;
    if (n > 0) hit++;
    else lines.add(f.statementMap[id]?.start.line ?? 0);
  }
  const branchLines = new Set<number>();
  for (const [id, counts] of Object.entries(f.b)) {
    counts.forEach((n, i) => {
      total++;
      if (n > 0) hit++;
      else branchLines.add(f.branchMap[id]?.locations[i]?.start.line ?? 0);
    });
  }
  const list = units.get(unit.name) ?? [];
  list.push({
    file: rel,
    total,
    hit,
    lines: [...lines].sort((a, b) => a - b),
    branchLines: [...branchLines].sort((a, b) => a - b),
  });
  units.set(unit.name, list);
}

for (const [name, rows] of [...units].sort(([a], [b]) => a.localeCompare(b))) {
  const total = rows.reduce((s, r) => s + r.total, 0);
  const hit = rows.reduce((s, r) => s + r.hit, 0);
  const pct = total === 0 ? 100 : (100 * hit) / total;
  const floor = floors[name];
  if (!files && (only ? name !== only : !all && floor !== undefined && pct >= floor)) continue;
  say(
    `\n## ${name}: ${pct.toFixed(2)}% (${hit}/${total}) floor ${floor ?? "none"}; need +${Math.max(0, Math.ceil(((floor ?? 0) / 100) * total - hit))} items`,
  );
  for (const r of rows
    .filter((x) => x.total - x.hit > 0)
    .sort((a, b) => b.total - b.hit - (a.total - a.hit))
    .slice(0, files ? 500 : 25)) {
    say(`  ${r.file}: missing ${r.total - r.hit} of ${r.total}`);
    say(`    stmt lines: ${ranges(r.lines)}`);
    say(`    branch lines: ${ranges(r.branchLines)}`);
  }
}
