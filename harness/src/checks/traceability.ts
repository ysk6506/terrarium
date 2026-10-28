/**
 * Requirement traceability (REQ-023, REQ-025). docs/product-specs/requirements.md is the single source
 * of requirements; tests link to them by putting `[REQ-NNN]` in a describe or test title.
 *
 * TRACE001 requirement with no test   TRACE002 test cites an unknown requirement
 * TRACE003 spec test file without any requirement link   TRACE004 requirement id defined twice
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { findRoot, finish, flag, isMain, parseArgs, type Violation, violation } from "../common";
import { lineOf, parse, ts, walk } from "../ts-ast";
import { testApi, testFiles } from "./test-units";
import { loadTestsConfig } from "./testguard";

const REQUIREMENTS = "docs/product-specs/requirements.md";
const ROW_RE = /^\|\s*(REQ-\d{3})\s*\|/;
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
  for (const id of ids.filter((i) => !covered.has(i))) {
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
  return finish("traceability", run(findRoot(flag(flags, "root"))), out);
}

if (isMain(import.meta.url)) process.exit(main(process.argv.slice(2)));
