/**
 * `pnpm ux`: measure the Honeycomb in a real browser, record it, and say what to fix (REQ-041).
 *   pnpm ux                     both: the journeys and every probe (starts a server and a browser), writes docs/generated/ux-score.json
 *   pnpm ux measure             the same as `pnpm ux`
 *   pnpm ux journeys [--group flow|build|own] [--only id,id]
 *                               only "can a person finish each journey" (the merge gate's `ux-journeys`, ADR-0141)
 *   pnpm ux ratchet             raise the floors to what the last measurement reached
 *   pnpm ux check               only the structural check that `pnpm check` runs (no browser)
 * The browser half lives in tests/e2e/ux/measure.ts; it prints raw counts and this file scores them.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { findRoot, finish, flag, isMain, parseArgs, today } from "../common";
import {
  buildReport,
  checkFloors,
  loadFloors,
  ratchet,
  run as structure,
  type UxReport,
  writeReport,
} from "./check";
import {
  FACET_LABELS,
  FACETS,
  type Facet,
  type FacetReport,
  parseMeasurements,
  type Report,
  scoreAll,
} from "./score";

export interface ChildResult {
  readonly code: number | null;
  readonly output: string;
}

export type Child = (
  command: string,
  args: readonly string[],
  options: { readonly cwd: string; readonly timeoutMs: number },
) => Promise<ChildResult>;

/** Run a program and collect what it prints (stdout and stderr together, in order). */
export const runChild: Child = (command, args, { cwd, timeoutMs }) =>
  new Promise((resolve) => {
    const child = spawn(command, [...args], { cwd, env: process.env });
    let output = "";
    // A long browser run in CI shows what it does while it does it: TERRARIUM_UX_ECHO=1.
    const echo = process.env.TERRARIUM_UX_ECHO === "1";
    const collect = (chunk: Buffer) => {
      output += chunk.toString("utf8");
      if (echo) process.stdout.write(chunk);
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, output });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: 1, output: `${output}${err.message}` });
    });
  });

export const MEASURE_SCRIPT = "tests/e2e/ux/measure.ts";
export const MEASURE_TIMEOUT_MS = 8 * 60_000;
/** A group of journeys has to finish in this long; longer is a hang, not a slow machine (ADR-0141). */
export const JOURNEYS_TIMEOUT_MS = 15 * 60_000;

/** Only the journeys: can a person finish each one? Prints a line per journey; the code is 0 when all were finished. */
export async function journeys(
  root: string,
  selection: { readonly group?: string; readonly only?: string },
  out: (line: string) => void,
  child: Child = runChild,
): Promise<number> {
  const args = ["tsx", MEASURE_SCRIPT, "--mode", "journeys"];
  if (selection.group) args.push("--group", selection.group);
  if (selection.only) args.push("--only", selection.only);
  const result = await child("npx", args, { cwd: root, timeoutMs: JOURNEYS_TIMEOUT_MS });
  for (const line of result.output.split("\n")) {
    if (line.startsWith("note: ") || line.startsWith("journeys: ") || line.startsWith("step: "))
      out(line);
  }
  if (result.code !== 0 && !result.output.includes("journeys: "))
    out(`브라우저 실행이 끝나지 않았다 (종료 코드 ${result.code})\n${result.output.slice(-2000)}`);
  return result.code === 0 ? 0 : 1;
}

/** Run the browser half and read the counts it wrote. */
export async function measure(
  root: string,
  child: Child = runChild,
): Promise<{ report: UxReport; notes: string[] }> {
  const dir = mkdtempSync(path.join(tmpdir(), "terrarium-ux-"));
  const out = path.join(dir, "measurements.json");
  try {
    const result = await child("npx", ["tsx", MEASURE_SCRIPT, "--out", out], {
      cwd: root,
      timeoutMs: MEASURE_TIMEOUT_MS,
    });
    if (result.code !== 0)
      throw new Error(
        `브라우저 측정이 실패했다 (종료 코드 ${result.code})\n${result.output.slice(-2000)}`,
      );
    const report = buildReport(
      root,
      parseMeasurements(JSON.parse(readFileSync(out, "utf8"))),
      today(),
    );
    const notes = result.output
      .split("\n")
      .filter(
        (l) => l.startsWith("note: ") && !l.startsWith("note: 여정") && !l.includes("에서 빈 화면"),
      )
      .map((l) => l.slice(6));
    return { report, notes };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** What keeps a facet from 100: the measures that are not perfect, with what was seen. */
function holdingBack(facet: FacetReport): string[] {
  return facet.measures
    .filter((m) => m.score < 0.995)
    .map((m) => `   ${String(Math.round(m.score * 100)).padStart(3)}%  ${m.label}: ${m.evidence}`);
}

/** The table people read: one line per facet, then what holds it back. */
export function describe(report: Report, floors: Partial<Record<Facet, number>>): string[] {
  const lines: string[] = [];
  for (const facet of FACETS) {
    const floor = floors[facet];
    const floorText = floor === undefined ? "하한 없음" : `하한 ${floor}`;
    const score = report[facet].score.toFixed(1).padStart(5);
    lines.push(`${FACET_LABELS[facet].padEnd(6)} ${facet.padEnd(11)} ${score}점  (${floorText})`);
    lines.push(...holdingBack(report[facet]));
  }
  return lines;
}

export async function main(
  argv: readonly string[],
  out: (line: string) => void = console.log,
  child: Child = runChild,
): Promise<number> {
  const { positional, flags } = parseArgs(argv);
  const root = findRoot(flag(flags, "root"));
  const action = positional[0] ?? "measure";
  if (action === "ratchet") {
    for (const [facet, floor] of Object.entries(ratchet(root))) out(`${facet}: ${floor}`);
    return 0;
  }
  if (action === "journeys") {
    const group = flag(flags, "group");
    const only = flag(flags, "only");
    return journeys(root, { ...(group ? { group } : {}), ...(only ? { only } : {}) }, out, child);
  }
  if (action === "check") return finish("ux", structure(root, flag(flags, "base")), out);
  if (action !== "measure") {
    out(`알 수 없는 명령: ${action} (measure, journeys, ratchet, check)`);
    return 2;
  }
  const { report, notes } = await measure(root, child);
  writeReport(root, report);
  for (const line of describe(scoreAll(report.measurements), loadFloors(root))) out(line);
  if (notes.length > 0) out(`\n본 것:\n${notes.map((n) => `  ${n}`).join("\n")}\n`);
  return finish("ux 하한", checkFloors(root), out);
}

if (isMain(import.meta.url)) main(process.argv.slice(2)).then((code) => process.exit(code));
