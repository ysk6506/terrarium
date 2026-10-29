import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { miniRepo } from "../test-support/mini-repo";
import { perfect, withChange } from "../test-support/ux-measurements";
import { FLOOR_FILE, loadReport, REPORT_FILE } from "./check";
import { type Child, describe as describeScores, main, measure, runChild } from "./run";
import { FACETS, type Measurements, scoreAll } from "./score";

const NO_LOG = () => undefined;

/** A stand-in for the browser run: writes the measurements where it was told to. */
const browser =
  (m: Measurements, code = 0, output = ""): Child =>
  async (_command, args) => {
    const to = args[args.indexOf("--out") + 1] as string;
    writeFileSync(to, JSON.stringify(m));
    return { code, output };
  };

const repo = (extra: Record<string, string> = {}) =>
  miniRepo({ "docs/generated/.keep": "", ...extra });
const lines = () => {
  const out: string[] = [];
  return { out, log: (l: string) => void out.push(l) };
};

describe("running a program and collecting what it says [REQ-041]", () => {
  test("output and exit code come back", async () => {
    const r = await runChild(process.execPath, ["-e", "console.log('hej'); process.exit(3)"], {
      cwd: process.cwd(),
      timeoutMs: 20_000,
    });
    expect(r.code).toBe(3);
    expect(r.output).toContain("hej");
  });

  test("a program that does not exist is a failure with a reason, not a crash", async () => {
    const r = await runChild("terrarium-no-such-program", [], {
      cwd: process.cwd(),
      timeoutMs: 5000,
    });
    expect(r.code).toBe(1);
    expect(r.output).toContain("ENOENT");
  });

  test("a program that never ends is stopped", async () => {
    const r = await runChild(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      cwd: process.cwd(),
      timeoutMs: 300,
    });
    expect(r.code).not.toBe(0);
  });
});

describe("measuring [REQ-041]", () => {
  test("reads the counts the browser wrote and scores them", async () => {
    const { report, notes } = await measure(
      repo(),
      browser(perfect(), 0, "note: 여정 build ok\nnote: keyboard: menu 못 했다\nstep: x 1초"),
    );
    expect(notes).toEqual(["keyboard: menu 못 했다"]);
    expect(report.scores.useful).toBe(100);
    expect(report.measurements).toEqual(perfect());
  });

  test("a failed browser run says why", async () => {
    await expect(measure(repo(), browser(perfect(), 1, "chromium missing"))).rejects.toThrow(
      /종료 코드 1[\s\S]*chromium missing/,
    );
  });

  test("a browser run that wrote nonsense is an error", async () => {
    const child: Child = async (_c, args) => {
      writeFileSync(args[args.indexOf("--out") + 1] as string, JSON.stringify({ journeys: 1 }));
      return { code: 0, output: "" };
    };
    await expect(measure(repo(), child)).rejects.toThrow("load");
  });
});

describe("what people read [REQ-041]", () => {
  test("one line per facet, and under it only what is not perfect", () => {
    const text = describeScores(scoreAll(perfect()), { useful: 90 });
    expect(text).toHaveLength(7);
    expect(text[0]).toContain("유용함");
    expect(text[0]).toContain("100.0점");
    expect(text[0]).toContain("하한 90");
    expect(text[1]).toContain("하한 없음");

    const worse = describeScores(scoreAll(withChange({ keyboard: { tried: 4, ok: 1 } })), {});
    expect(worse.some((l) => l.includes("25%") && l.includes("키보드만으로 해낸 일: 1 / 4"))).toBe(
      true,
    );
  });
});

describe("the command line [REQ-041]", () => {
  test("measure records the result and checks the floors", async () => {
    const root = repo({
      [FLOOR_FILE]: JSON.stringify(Object.fromEntries(FACETS.map((f) => [f, 90]))),
    });
    const { out, log } = lines();
    const code = await main(["--root", root], log, browser(perfect()));
    expect(code).toBe(0);
    expect(out.join("\n")).toContain("OK   ux 하한");
    expect(typeof loadReport(root)).toBe("object");
    expect(readFileSync(path.join(root, REPORT_FILE), "utf8")).toContain('"measuredOn"');
  });

  test("a score under its floor fails the run and says what to fix", async () => {
    const root = repo({
      [FLOOR_FILE]: JSON.stringify(Object.fromEntries(FACETS.map((f) => [f, 90]))),
    });
    const { out, log } = lines();
    const code = await main(
      ["--root", root],
      log,
      browser(withChange({ empties: { tried: 4, ok: 0 } })),
    );
    expect(code).toBe(1);
    expect(out.join("\n")).toContain("[UX001]");
    expect(out.join("\n")).toContain("이유와 다음 할 일을 말하는 빈 화면");
  });

  test("ratchet raises the floors from the last measurement", async () => {
    const root = repo();
    await main(["--root", root], NO_LOG, browser(perfect()));
    const { out, log } = lines();
    expect(await main(["ratchet", "--root", root], log)).toBe(0);
    expect(out).toContain("useful: 98");
  });

  test("check is the browser-free structural check", async () => {
    const root = repo({
      [FLOOR_FILE]: JSON.stringify(Object.fromEntries(FACETS.map((f) => [f, 90]))),
    });
    const { out, log } = lines();
    expect(await main(["check", "--root", root], log)).toBe(1);
    expect(out.join("\n")).toContain("[UX004]");
    await main(["--root", root], NO_LOG, browser(perfect()));
    expect(await main(["check", "--root", root], NO_LOG)).toBe(0);
  });

  test("an unknown command is refused", async () => {
    const { out, log } = lines();
    expect(await main(["dance", "--root", repo()], log)).toBe(2);
    expect(out[0]).toContain("알 수 없는 명령");
  });
});
