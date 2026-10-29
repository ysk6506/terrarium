/**
 * The structural half of the UX check (REQ-041, ADR-0031). It never opens a browser: it reads the
 * last measurement (docs/generated/ux-score.json) and the floors (harness/config/ux-floor.json).
 *
 * UX001 a facet's score is below its floor            UX002 a floor is missing or not a usable number
 * UX003 (with --base) a floor was lowered             UX004 no measurement, or the web app changed since it
 * UX005 the recorded scores do not follow from the recorded measurements (edited by hand)
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { git, type Violation, violation } from "../common";
import { listFiles } from "../files";
import {
  FACET_LABELS,
  FACETS,
  type Facet,
  type Measurements,
  parseMeasurements,
  scoreAll,
  scoresOf,
} from "./score";

export const REPORT_FILE = "docs/generated/ux-score.json";
export const FLOOR_FILE = "harness/config/ux-floor.json";
/** A floor never goes below this: a facet that cannot reach it has to be improved first. */
export const MIN_FLOOR = 70;
/** Measurements wobble a little (timings); floors sit this far under the score they were set from. */
export const MARGIN = 2;
/** What the measurement depends on: when any of it changes, the last measurement no longer counts. */
const WATCHED_DIRS = ["apps/web/src", "tests/e2e/ux"];
const WATCHED_FILES = ["apps/web/index.html", "harness/src/ux/score.ts"];

export interface UxReport {
  readonly measuredOn: string;
  readonly webHash: string;
  readonly scores: Record<Facet, number>;
  readonly measurements: Measurements;
}

/** A short fingerprint of everything the measurement looks at. */
export function webHash(root: string): string {
  const hash = createHash("sha256");
  const files = [...listFiles(root, WATCHED_DIRS, () => true), ...WATCHED_FILES].sort();
  for (const file of files) {
    const full = path.join(root, file);
    if (!existsSync(full)) continue;
    hash.update(`${file}\n`);
    hash.update(readFileSync(full));
  }
  return hash.digest("hex").slice(0, 16);
}

export function buildReport(
  root: string,
  measurements: Measurements,
  measuredOn: string,
): UxReport {
  return {
    measuredOn,
    webHash: webHash(root),
    scores: scoresOf(scoreAll(measurements)),
    measurements,
  };
}

export function writeReport(root: string, report: UxReport): void {
  writeFileSync(path.join(root, REPORT_FILE), `${JSON.stringify(report, null, 2)}\n`);
}

/** The last measurement, or the reason it cannot be used. */
export function loadReport(root: string): UxReport | string {
  const file = path.join(root, REPORT_FILE);
  if (!existsSync(file)) return "측정 결과 파일이 없다";
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    if (typeof raw.measuredOn !== "string" || typeof raw.webHash !== "string")
      return "measuredOn과 webHash가 없다";
    const measurements = parseMeasurements(raw.measurements);
    return {
      measuredOn: raw.measuredOn,
      webHash: raw.webHash,
      scores: raw.scores as Record<Facet, number>,
      measurements,
    };
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

export function loadFloors(root: string): Partial<Record<Facet, number>> {
  const file = path.join(root, FLOOR_FILE);
  if (!existsSync(file)) return {};
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    return Object.fromEntries(
      FACETS.flatMap((f) => (typeof raw[f] === "number" ? [[f, raw[f]]] : [])),
    ) as Partial<Record<Facet, number>>;
  } catch {
    return {};
  }
}

const validFloor = (n: number | undefined): n is number =>
  n !== undefined && Number.isFinite(n) && n >= MIN_FLOOR && n <= 100;

export function checkReport(root: string): Violation[] {
  const report = loadReport(root);
  if (typeof report === "string")
    return [
      violation(
        "UX004",
        REPORT_FILE,
        0,
        `UX 측정 결과를 읽을 수 없다: ${report}`,
        "`pnpm ux`로 측정한다 (브라우저가 필요하다).",
      ),
    ];
  const out: Violation[] = [];
  if (report.webHash !== webHash(root))
    out.push(
      violation(
        "UX004",
        REPORT_FILE,
        0,
        "측정한 뒤에 웹 화면이나 UX 측정 코드가 바뀌었다",
        "`pnpm ux`로 다시 측정하고, 오른 점수는 `pnpm ux ratchet`으로 하한에 반영한다.",
      ),
    );
  const expected = scoresOf(scoreAll(report.measurements));
  const edited = FACETS.filter((f) => report.scores?.[f] !== expected[f]);
  if (edited.length > 0)
    out.push(
      violation(
        "UX005",
        REPORT_FILE,
        0,
        `기록된 점수가 측정값에서 나오는 점수와 다르다: ${edited.join(", ")}`,
        "점수 파일은 손으로 고치지 않는다. `pnpm ux`로 다시 측정한다.",
      ),
    );
  return out;
}

export function checkFloors(root: string): Violation[] {
  const floors = loadFloors(root);
  const report = loadReport(root);
  const out: Violation[] = [];
  for (const facet of FACETS) {
    const floor = floors[facet];
    if (!validFloor(floor)) {
      out.push(
        violation(
          "UX002",
          FLOOR_FILE,
          0,
          `${FACET_LABELS[facet]}(${facet})의 하한이 없거나 ${MIN_FLOOR} 미만이다`,
          `점수를 ${MIN_FLOOR + MARGIN} 이상으로 올린 뒤 \`pnpm ux ratchet\`으로 하한을 정한다.`,
        ),
      );
      continue;
    }
    const score = typeof report === "string" ? undefined : report.scores[facet];
    if (score !== undefined && score + 1e-9 < floor)
      out.push(
        violation(
          "UX001",
          REPORT_FILE,
          0,
          `${FACET_LABELS[facet]}(${facet}) ${score}점이 하한 ${floor}점보다 낮다`,
          "`pnpm ux`가 찍어 주는 낮은 측정 항목을 고친다. 하한을 내리지 않는다.",
        ),
      );
  }
  return out;
}

export function checkFloorsAgainst(root: string, base: string): Violation[] {
  const previous = git(root, "show", `${base}:${FLOOR_FILE}`);
  if (previous === null) return [];
  const old = JSON.parse(previous) as Record<string, number>;
  const now = loadFloors(root);
  return Object.entries(old)
    .filter(([facet, value]) => (now[facet as Facet] ?? -1) + 1e-9 < value)
    .map(([facet, value]) =>
      violation(
        "UX003",
        FLOOR_FILE,
        0,
        `${facet}의 하한이 ${value}에서 ${now[facet as Facet] ?? "없음"}으로 내려갔다`,
        "하한은 오르기만 한다. 되돌리고 화면을 고친다.",
      ),
    );
}

/** The structural check that runs inside `pnpm check`. */
export function run(root: string, base?: string): Violation[] {
  return [
    ...checkReport(root),
    ...checkFloors(root),
    ...(base ? checkFloorsAgainst(root, base) : []),
  ];
}

/** Raise each floor to the last score minus the margin. Never lowers one, and never goes under MIN_FLOOR. */
export function ratchet(root: string): Record<string, number> {
  const report = loadReport(root);
  if (typeof report === "string") throw new Error(`측정 결과가 없다: ${report}`);
  if (report.webHash !== webHash(root))
    throw new Error("마지막 측정 뒤에 화면이 바뀌었다. `pnpm ux`로 다시 측정한 뒤에 하한을 올린다");
  const floors = loadFloors(root);
  const next: Record<string, number> = {};
  for (const facet of FACETS) {
    const candidate = Math.min(100, Math.floor(report.scores[facet]) - MARGIN);
    const value = Math.max(floors[facet] ?? 0, candidate);
    if (value >= MIN_FLOOR) next[facet] = value;
  }
  writeFileSync(path.join(root, FLOOR_FILE), `${JSON.stringify(next, null, 2)}\n`);
  return next;
}
