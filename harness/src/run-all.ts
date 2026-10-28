/** Run every structural check and print one verdict (`pnpm structure`, part of `pnpm check`). */
import { run as architecture } from "./checks/architecture";
import { run as coverage } from "./checks/coverage";
import { run as debt } from "./checks/debt";
import { run as docs } from "./checks/docs";
import { run as protectedPaths } from "./checks/protected";
import { run as testguard } from "./checks/testguard";
import { run as traceability } from "./checks/traceability";
import { findRoot, finish, flag, isMain, parseArgs, today, type Violation } from "./common";

export type Check = readonly [name: string, run: () => Violation[]];

export function checks(root: string, base: string | undefined, withCoverage: boolean): Check[] {
  const plan: Check[] = [
    ["architecture", () => architecture(root)],
    ["docs", () => docs(root)],
    ["debt", () => debt(root, today(), base)],
    ["test-integrity", () => testguard(root, base)],
    ["traceability", () => traceability(root)],
    ["protected-paths", () => protectedPaths(root, base)],
  ];
  if (withCoverage) plan.push(["coverage", () => coverage(root, base)]);
  return plan;
}

export function main(argv: readonly string[], out: (line: string) => void = console.log): number {
  const { flags } = parseArgs(argv);
  const root = findRoot(flag(flags, "root"));
  let failed = 0;
  for (const [name, run] of checks(root, flag(flags, "base"), flags.has("with-coverage")))
    failed += finish(name, run(), out);
  out(failed === 0 ? "\nALL CHECKS PASSED" : `\n${failed} CHECK(S) FAILED`);
  return failed === 0 ? 0 : 1;
}

if (isMain(import.meta.url)) process.exit(main(process.argv.slice(2)));
