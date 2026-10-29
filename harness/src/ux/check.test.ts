import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { commitAll, miniRepo, writeFiles } from "../test-support/mini-repo";
import { perfect, withChange } from "../test-support/ux-measurements";
import {
  buildReport,
  checkFloors,
  checkFloorsAgainst,
  checkReport,
  FLOOR_FILE,
  loadFloors,
  loadReport,
  MARGIN,
  MIN_FLOOR,
  REPORT_FILE,
  ratchet,
  run,
  webHash,
  writeReport,
} from "./check";
import { FACETS } from "./score";

const DAY = "2026-10-29";

function repo(extra: Record<string, string> = {}): string {
  return miniRepo({
    "apps/web/src/a.tsx": "export const a = 1;\n",
    "apps/web/index.html": "<html></html>\n",
    "tests/e2e/ux/measure.ts": "export {};\n",
    "harness/src/ux/score.ts": "export {};\n",
    "docs/generated/.keep": "",
    ...extra,
  });
}

const floors = (n: number) => JSON.stringify(Object.fromEntries(FACETS.map((f) => [f, n])));
const codes = (root: string, base?: string) =>
  run(root, base)
    .map((v) => v.code)
    .sort();

function measured(root: string, change = perfect()): void {
  writeReport(root, buildReport(root, change, DAY));
}

describe("the fingerprint of what the measurement looks at [REQ-041]", () => {
  test("changes with the web app and the measuring code, not with anything else", () => {
    const root = repo();
    const before = webHash(root);
    expect(webHash(root)).toBe(before);
    writeFiles(root, { "docs/other.md": "x" });
    expect(webHash(root)).toBe(before);
    writeFiles(root, { "apps/web/src/a.tsx": "export const a = 2;\n" });
    const afterWeb = webHash(root);
    expect(afterWeb).not.toBe(before);
    writeFiles(root, { "tests/e2e/ux/measure.ts": "export const x = 1;\n" });
    const afterMeasure = webHash(root);
    expect(afterMeasure).not.toBe(afterWeb);
    writeFiles(root, { "harness/src/ux/score.ts": "export const y = 1;\n" });
    expect(webHash(root)).not.toBe(afterMeasure);
  });

  test("a repo without those files still has a hash", () => {
    expect(webHash(miniRepo())).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("the recorded measurement [REQ-041]", () => {
  test("is written, read back, and checked", () => {
    const root = repo();
    measured(root);
    const read = loadReport(root);
    expect(typeof read).toBe("object");
    expect(checkReport(root)).toEqual([]);
  });

  test.each([
    ["missing", (root: string) => root, "파일이 없다"],
    [
      "not JSON",
      (root: string) => {
        writeFiles(root, { [REPORT_FILE]: "{oops" });
        return root;
      },
      "JSON",
    ],
    [
      "without a date",
      (root: string) => {
        writeFiles(root, { [REPORT_FILE]: JSON.stringify({ webHash: "x" }) });
        return root;
      },
      "measuredOn",
    ],
    [
      "with broken measurements",
      (root: string) => {
        writeFiles(root, {
          [REPORT_FILE]: JSON.stringify({ measuredOn: DAY, webHash: "x", measurements: {} }),
        });
        return root;
      },
      "load",
    ],
  ])("%s cannot be used (UX004)", (_name, prepare, why) => {
    const root = prepare(repo());
    const found = checkReport(root);
    expect(found.map((v) => v.code)).toEqual(["UX004"]);
    expect(found[0]?.message).toContain(why);
    expect(loadReport(root)).toEqual(expect.any(String));
  });

  test("goes stale when the web app changes (UX004)", () => {
    const root = repo();
    measured(root);
    writeFiles(root, { "apps/web/src/a.tsx": "export const a = 3;\n" });
    const found = checkReport(root);
    expect(found.map((v) => v.code)).toEqual(["UX004"]);
    expect(found[0]?.fix).toContain("pnpm ux");
  });

  test("cannot be raised by hand: scores must follow from the counts (UX005)", () => {
    const root = repo();
    measured(root, withChange({ keyboard: { tried: 5, ok: 2 } }));
    const file = path.join(root, REPORT_FILE);
    const report = JSON.parse(readFileSync(file, "utf8"));
    report.scores.accessible = 100;
    writeFileSync(file, JSON.stringify(report));
    const found = checkReport(root);
    expect(found.map((v) => v.code)).toEqual(["UX005"]);
    expect(found[0]?.message).toContain("accessible");
  });

  test("scores missing from the file count as edited (UX005)", () => {
    const root = repo();
    measured(root);
    const file = path.join(root, REPORT_FILE);
    const report = JSON.parse(readFileSync(file, "utf8"));
    delete report.scores;
    writeFileSync(file, JSON.stringify(report));
    expect(checkReport(root).map((v) => v.code)).toEqual(["UX005"]);
  });
});

describe("floors [REQ-041]", () => {
  test("every facet needs a usable floor (UX002)", () => {
    const root = repo();
    measured(root);
    expect(checkFloors(root).map((v) => v.code)).toEqual(Array(7).fill("UX002"));
    writeFiles(root, { [FLOOR_FILE]: floors(MIN_FLOOR - 1) });
    expect(checkFloors(root).map((v) => v.code)).toEqual(Array(7).fill("UX002"));
    writeFiles(root, { [FLOOR_FILE]: floors(101) });
    expect(checkFloors(root)).toHaveLength(7);
    writeFiles(root, { [FLOOR_FILE]: "not json" });
    expect(loadFloors(root)).toEqual({});
  });

  test("a score under its floor fails with the facet named (UX001)", () => {
    const root = repo({ [FLOOR_FILE]: floors(90) });
    measured(root, withChange({ keyboard: { tried: 5, ok: 0 } }));
    const found = checkFloors(root);
    expect(found.map((v) => v.code)).toEqual(["UX001"]);
    expect(found[0]?.message).toContain("accessible");
  });

  test("floors without any measurement do not hide behind it", () => {
    const root = repo({ [FLOOR_FILE]: floors(90) });
    expect(checkFloors(root)).toEqual([]);
    expect(codes(root)).toEqual(["UX004"]);
  });

  test("a clean run passes everything", () => {
    const root = repo({ [FLOOR_FILE]: floors(90) });
    measured(root);
    expect(codes(root)).toEqual([]);
  });

  test("a floor that went down since the base is refused (UX003)", () => {
    const root = repo({ [FLOOR_FILE]: floors(90) });
    measured(root);
    commitAll(root);
    expect(codes(root, "HEAD")).toEqual([]);
    mkdirSync(path.dirname(path.join(root, FLOOR_FILE)), { recursive: true });
    writeFileSync(path.join(root, FLOOR_FILE), floors(80));
    const found = run(root, "HEAD").filter((v) => v.code === "UX003");
    expect(found).toHaveLength(7);
    expect(found[0]?.message).toContain("90");
    writeFileSync(path.join(root, FLOOR_FILE), JSON.stringify({ useful: 95 }));
    expect(
      checkFloorsAgainst(root, "HEAD")
        .map((v) => v.message)
        .join(" "),
    ).toContain("없음");
  });

  test("no floor file at the base means nothing to compare", () => {
    const root = repo();
    commitAll(root);
    expect(checkFloorsAgainst(root, "HEAD")).toEqual([]);
  });
});

describe("raising floors [REQ-041]", () => {
  test("sets each floor a margin under the score, and never lowers one", () => {
    const root = repo({ [FLOOR_FILE]: JSON.stringify({ useful: 99, usable: MIN_FLOOR }) });
    measured(
      root,
      withChange({
        keyboard: { tried: 4, ok: 0 },
        focus: { tried: 4, ok: 0 },
        motion: { animated: 10 },
      }),
    );
    const next = ratchet(root);
    expect(next.useful).toBe(99);
    expect(next.usable).toBe(100 - MARGIN);
    expect(next.accessible).toBeUndefined();
    expect(JSON.parse(readFileSync(path.join(root, FLOOR_FILE), "utf8"))).toEqual(next);
    expect(loadFloors(root).findable).toBe(98);
  });

  test("needs a measurement, and one that still describes the screens", () => {
    expect(() => ratchet(repo())).toThrow("측정 결과가 없다");
    const root = repo();
    measured(root);
    writeFiles(root, { "apps/web/src/a.tsx": "export const a = 9;\n" });
    expect(() => ratchet(root)).toThrow("다시 측정");
  });
});
