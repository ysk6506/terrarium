/**
 * Requirement traceability (REQ-023, REQ-025). docs/product-specs/requirements.md is the single source
 * of requirements; tests link to them by putting `[REQ-NNN]` in a describe or test title.
 *
 * TRACE001 requirement with no test   TRACE002 test cites an unknown requirement
 * TRACE003 spec test file without any requirement link   TRACE004 requirement id defined twice
 *
 * A requirement that is decided but not built yet starts its text with `**예정(ADR-NNNN)**` (TD-0003). It
 * needs no test and is listed as "예정" instead of failing, but the ADR must exist (TRACE005), and the
 * marker must go once a test cites the requirement (TRACE006), so it cannot hide an implemented one.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { findRoot, finish, flag, isMain, parseArgs, type Violation, violation } from "../common";
import { lineOf, parse, ts, walk } from "../ts-ast";
import { testApi, testFiles } from "./test-units";
import { loadTestsConfig } from "./testguard";

const REQUIREMENTS = "docs/product-specs/requirements.md";
const ROW_RE = /^\|\s*(REQ-\d{3})\s*\|/;
const PLANNED_RE = /^\|\s*(REQ-\d{3})\s*\|\s*\*\*예정\((ADR-\d{4})\)\*\*/;
const ADR_DIR = "docs/design-docs/adr";
const REF_RE = /REQ-\d{3}/g;
const LINKED_DIRS = ["tests/spec/"];

export function requirementIds(root: string): { ids: string[]; violations: Violation[] } {
  const ids: string[] = [];
  const violations: Violation[] = [];
  readFileSync(path.join(root, REQUIREMENTS), "utf8")
    .split("\n")
    .forEach((line, index) => {
      const id = ROW_RE.exec(line)?.[1];
      if (!id) return;
      if (ids.includes(id))
        violations.push(
          violation(
            "TRACE004",
            REQUIREMENTS,
            index + 1,
            `${id} defined twice`,
            "Give each requirement a unique id.",
          ),
        );
      ids.push(id);
    });
  return { ids, violations };
}

/** Requirements marked 예정 (planned), with the ADR that plans them. */
export function plannedRequirements(root: string): Map<string, string> {
  const planned = new Map<string, string>();
  for (const line of readFileSync(path.join(root, REQUIREMENTS), "utf8").split("\n")) {
    const match = PLANNED_RE.exec(line);
    if (match?.[1] && match[2]) planned.set(match[1], match[2]);
  }
  return planned;
}

const adrExists = (root: string, adr: string): boolean => {
  const dir = path.join(root, ADR_DIR);
  const prefix = `${adr.slice(4)}-`;
  return existsSync(dir) && readdirSync(dir).some((name) => name.startsWith(prefix));
};

/** One line per planned requirement that still has no test, for the verdict output. */
export function plannedLines(root: string): string[] {
  const covered = coveredIds(root);
  const open = [...plannedRequirements(root)].filter(([id]) => !covered.has(id));
  if (open.length === 0) return [];
  return [`PLAN traceability: 예정 ${open.length}건 (테스트 없음, 실패 아님)`].concat(
    open.map(([id, adr]) => `     ${id} (${adr})`),
  );
}

function coveredIds(root: string): Set<string> {
  const covered = new Set<string>();
  for (const file of testFiles(root, loadTestsConfig(root)))
    for (const [id] of citations(root, file)) covered.add(id);
  return covered;
}

/** Requirement ids cited in describe/test titles of a file, with line numbers. */
export function citations(root: string, file: string): Array<[string, number]> {
  const sf = parse(file, readFileSync(path.join(root, file), "utf8"));
  const found: Array<[string, number]> = [];
  walk(sf, (node) => {
    if (!ts.isCallExpression(node) || !testApi(node)) return;
    const title = node.arguments[0];
    if (title && ts.isStringLiteralLike(title)) {
      for (const match of title.text.matchAll(REF_RE))
        found.push([match[0], lineOf(sf, node.getStart(sf))]);
    }
  });
  return found;
}

export function run(root: string): Violation[] {
  const { ids, violations } = requirementIds(root);
  const config = loadTestsConfig(root);
  const covered = new Set<string>();
  for (const file of testFiles(root, config)) {
    const cited = citations(root, file);
    for (const [id, line] of cited) {
      covered.add(id);
      if (!ids.includes(id))
        violations.push(
          violation(
            "TRACE002",
            file,
            line,
            `${id} is not a requirement`,
            `Use an id from ${REQUIREMENTS}.`,
          ),
        );
    }
    if (LINKED_DIRS.some((dir) => file.startsWith(dir)) && cited.length === 0) {
      violations.push(
        violation(
          "TRACE003",
          file,
          1,
          "spec test is not linked to a requirement",
          "Put [REQ-NNN] in the describe title.",
        ),
      );
    }
  }
  const planned = plannedRequirements(root);
  for (const [id, adr] of planned) {
    if (!adrExists(root, adr))
      violations.push(
        violation(
          "TRACE005",
          REQUIREMENTS,
          0,
          `${id} cites ${adr}, which does not exist`,
          "Name the ADR that plans it.",
        ),
      );
    if (covered.has(id))
      violations.push(
        violation(
          "TRACE006",
          REQUIREMENTS,
          0,
          `${id} is marked 예정 but a test cites it`,
          "Remove the 예정 marker.",
        ),
      );
  }
  for (const id of ids.filter((i) => !covered.has(i) && !planned.has(i))) {
    violations.push(
      violation(
        "TRACE001",
        REQUIREMENTS,
        0,
        `${id} has no test`,
        `Write a test titled with [${id}] that would fail if the requirement were not met.`,
      ),
    );
  }
  return violations;
}

export function main(argv: readonly string[], out: (line: string) => void = console.log): number {
  const { flags } = parseArgs(argv);
  const root = findRoot(flag(flags, "root"));
  const code = finish("traceability", run(root), out);
  for (const line of plannedLines(root)) out(line);
  return code;
}

if (isMain(import.meta.url)) process.exit(main(process.argv.slice(2)));
