import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { findRoot } from "../common";
import { miniRepo } from "../test-support/mini-repo";
import { perfect, withChange } from "../test-support/ux-measurements";
import { loadReport } from "./check";
import { mergeParts } from "./merge";
import { main } from "./run";
import { type Measurements, scoreAll, scoresOf } from "./score";

const root = findRoot();
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

interface Slice {
  groups: string[];
  probes: string[];
  fresh: boolean;
}

/** The slices of tests/e2e/ux/parts.ts: name -> journey groups and probes, read as text (the file is not importable from here). */
function parts(): Record<string, Slice> {
  const source = read("tests/e2e/ux/parts.ts");
  const table = source.slice(source.indexOf("export const PARTS"));
  const found: Record<string, Slice> = {};
  for (const m of table.matchAll(/^\s+"([a-z-]+)": \{([^}]*)\},?$/gm)) {
    const body = m[2] as string;
    const list = (key: string): string[] => {
      const at = /\[([^\]]*)\]/.exec(body.split(`${key}:`)[1] ?? "");
      return at ? [...(at[1] as string).matchAll(/"([a-z-]+)"/g)].map((x) => x[1] as string) : [];
    };
    found[m[1] as string] = {
      groups: list("groups"),
      probes: list("probes"),
      fresh: body.includes("fresh: true"),
    };
  }
  return found;
}

const groupsOf = (): Record<string, string[]> => {
  const source = read("tests/e2e/ux/journeys.ts");
  const block = source.slice(source.indexOf("export const JOURNEY_GROUPS"));
  const found: Record<string, string[]> = {};
  for (const m of block.slice(0, block.indexOf("};")).matchAll(/^\s+(\w+): \[([^\]]*)\]/gm))
    found[m[1] as string] = [...(m[2] as string).matchAll(/"([a-z-]+)"/g)].map(
      (x) => x[1] as string,
    );
  return found;
};

/** The fields of the measurement each probe fills, as tests/e2e/ux/measure.ts writes them. */
const FIELDS: Record<string, (keyof Measurements)[]> = {
  keyboard: ["keyboard", "focus"],
  invalid: ["invalid"],
  colors: ["colors"],
  progress: ["progress"],
  load: ["load"],
  reach: ["reach"],
  orientation: ["orientation"],
  axe: ["axe"],
  motion: ["motion"],
  provenance: ["provenance"],
  value: ["value"],
  voice: ["voice", "oneThing", "buttons"],
  detail: ["targets", "disabledWhy", "units", "hover"],
};

/** What each slice would write for a whole measurement `m`: the slices partition it the way parts.ts says. */
function slices(m: Measurements): Record<string, unknown>[] {
  const groups = groupsOf();
  return Object.entries(parts()).map(([name, part]) => {
    const ids = part.groups.flatMap((g) => groups[g] ?? []);
    const out: Record<string, unknown> = { part: name, notes: [`${name} noticed`] };
    if (ids.length > 0) {
      out.journeys = Object.fromEntries(
        ids.map((id) => [id, m.journeys[id as keyof Measurements["journeys"]]]),
      );
      out.clean = { tried: ids.length, ok: ids.length };
    }
    if (part.fresh) Object.assign(out, { failures: m.failures, empties: m.empties });
    for (const probe of part.probes) for (const field of FIELDS[probe] ?? []) out[field] = m[field];
    return out;
  });
}

describe("the slices of a measurement lose none and repeat none [REQ-114]", () => {
  test("every journey group is in exactly one slice", () => {
    const groups = Object.keys(groupsOf()).sort();
    const used = Object.values(parts()).flatMap((p) => p.groups);
    expect([...used].sort()).toEqual(groups);
  });

  test("every probe of a whole run is in exactly one slice", () => {
    const source = read("tests/e2e/ux/measure.ts");
    const list = source.slice(source.indexOf("const ALL_PROBES"));
    const all = [...list.slice(0, list.indexOf("];")).matchAll(/"([a-z]+)"/g)].map((m) => m[1]);
    const used = Object.values(parts()).flatMap((p) => p.probes);
    expect([...used].sort()).toEqual([...all].sort());
    expect(Object.keys(FIELDS).sort()).toEqual([...all].sort());
  });

  test("exactly one slice looks at the empty and error screens", () => {
    expect(Object.values(parts()).filter((p) => p.fresh)).toHaveLength(1);
  });
});

describe("putting the slices together gives what a whole run gives [REQ-114]", () => {
  test("the merged measurements and their scores equal the whole run's", () => {
    const whole = withChange({
      empties: { tried: 4, ok: 3 },
      axe: { pages: 24, critical: 0, serious: 1, moderate: 2 },
    });
    const merged = mergeParts(slices(whole));
    expect(merged.measurements.axe).toEqual(whole.axe);
    expect(merged.measurements.empties).toEqual(whole.empties);
    expect(merged.measurements.journeys).toEqual(whole.journeys);
    const joined = { ...whole, clean: merged.measurements.clean };
    expect(scoresOf(scoreAll(merged.measurements))).toEqual(scoresOf(scoreAll(joined)));
    expect(merged.notes).toHaveLength(Object.keys(parts()).length);
  });

  test("the clean-screen tallies of the slices add up", () => {
    const merged = mergeParts(slices(perfect()));
    expect(merged.measurements.clean.tried).toBe(Object.values(groupsOf()).flat().length);
  });

  test("a field in two slices, a journey in two slices and a missing field are errors, not guesses", () => {
    const some = slices(perfect());
    expect(() => mergeParts([...some, { axe: perfect().axe }])).toThrow(/axe/);
    expect(() => mergeParts([...some, { journeys: { run: { ok: true, actions: 2 } } }])).toThrow(
      /run/,
    );
    expect(() => mergeParts(some.slice(1))).toThrow();
    expect(() => mergeParts([42])).toThrow(/객체/);
  });

  test("`ux merge <dir>` writes the record and the verdict a whole run writes", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "terrarium-ux-merge-"));
    try {
      const whole = perfect();
      for (const piece of slices(whole))
        writeFileSync(path.join(dir, `${piece.part}.json`), JSON.stringify(piece));
      expect(readdirSync(dir)).toHaveLength(Object.keys(parts()).length);
      const repo = miniRepo({
        "docs/generated/.keep": "",
        "harness/config/ux-floor.json": JSON.stringify(
          Object.fromEntries(Object.keys(scoresOf(scoreAll(whole))).map((f) => [f, 90])),
        ),
      });
      const out: string[] = [];
      const code = await main(["merge", dir, "--root", repo], (l) => void out.push(l));
      expect(code).toBe(0);
      expect(typeof loadReport(repo)).not.toBe("string");
      expect(out.join("\n")).toContain("하한 90");
      expect(await main(["merge", "--root", repo], () => undefined)).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
