import { describe, expect, test } from "vitest";
import { perfect, withChange } from "../test-support/ux-measurements";
import {
  axeScore,
  FACETS,
  JOURNEY_BUDGETS,
  JOURNEY_IDS,
  parseMeasurements,
  ratio,
  scoreAll,
  scoresOf,
  withinBudget,
} from "./score";

describe("turning counts into Honeycomb scores [REQ-041]", () => {
  test("a run where everything works scores 100 on every facet", () => {
    const scores = scoresOf(scoreAll(perfect()));
    for (const facet of FACETS) expect(scores[facet]).toBe(100);
  });

  test("nothing measured is worth nothing, never full marks", () => {
    expect(ratio({ tried: 0, ok: 0 })).toBe(0);
    const empty = withChange({ keyboard: { tried: 0, ok: 0 }, focus: { tried: 0, ok: 0 } });
    const report = scoreAll(empty);
    expect(report.accessible.measures.find((m) => m.id === "keyboard")?.evidence).toBe(
      "측정된 것이 없다",
    );
    expect(report.accessible.score).toBeLessThan(100);
    expect(axeScore({ pages: 0, critical: 0, serious: 0, moderate: 0 })).toBe(0);
    expect(
      scoreAll(withChange({ colors: { literals: 0, offToken: 0 } })).desirable.measures[0]?.score,
    ).toBe(0);
  });

  test("a budget is met until it is exceeded, and gone at twice the budget", () => {
    expect(withinBudget(5, 5)).toBe(1);
    expect(withinBudget(0, 5)).toBe(1);
    expect(withinBudget(7.5, 5)).toBe(0.5);
    expect(withinBudget(10, 5)).toBe(0);
    expect(withinBudget(50, 5)).toBe(0);
  });

  test("a journey that fails scores nothing for usability and is named", () => {
    const m = perfect();
    const broken = { ...m, journeys: { ...m.journeys, share: { ok: false, actions: 1 } } };
    const report = scoreAll(broken);
    expect(report.useful.measures[0]?.evidence).toBe("못한 것: share");
    expect(report.useful.score).toBeLessThan(100);
    expect(report.usable.score).toBeLessThan(100);
  });

  test("too many actions lower usability and say which journey", () => {
    const m = perfect();
    const slow = {
      ...m,
      journeys: { ...m.journeys, run: { ok: true, actions: JOURNEY_BUDGETS.run * 2 } },
    };
    const usable = scoreAll(slow).usable;
    expect(usable.measures[0]?.evidence).toBe(
      `예산 넘음: run ${JOURNEY_BUDGETS.run * 2}/${JOURNEY_BUDGETS.run}`,
    );
    expect(usable.measures[0]?.score).toBeCloseTo((JOURNEY_IDS.length - 1) / JOURNEY_IDS.length, 5);
  });

  test("axe findings cost by how bad they are", () => {
    expect(axeScore({ pages: 5, critical: 1, serious: 0, moderate: 0 })).toBeCloseTo(0.8);
    expect(axeScore({ pages: 5, critical: 0, serious: 2, moderate: 0 })).toBeCloseTo(0.8);
    expect(axeScore({ pages: 5, critical: 0, serious: 0, moderate: 5 })).toBeCloseTo(0.9);
    expect(axeScore({ pages: 5, critical: 9, serious: 9, moderate: 9 })).toBe(0);
  });

  test("a slow or heavy first page and a blank 3D scene cost points", () => {
    const heavy = scoreAll(withChange({ load: { kb: 1400, ms: 5000, sceneDrawn: false } }));
    const scores = heavy.desirable.measures.map((x) => x.score);
    expect(scores.slice(2)).toEqual([0, 0, 0]);
    expect(heavy.desirable.score).toBeLessThan(70);
  });

  test("animation that ignores 'less motion' lowers accessibility a tenth each", () => {
    const motion = scoreAll(withChange({ motion: { animated: 3 } })).accessible.measures.find(
      (m) => m.id === "motion",
    );
    expect(motion?.score).toBeCloseTo(0.7);
  });

  test("scores are rounded to one decimal", () => {
    const m = withChange({ reach: { tried: 3, ok: 1 } });
    expect(scoreAll(m).findable.score).toBe(66.7);
  });
});

describe("reading a measurement file [REQ-041]", () => {
  const good = () => JSON.parse(JSON.stringify(perfect())) as Record<string, unknown>;

  test("a good file round-trips, and notes on journeys are kept", () => {
    const raw = good();
    (raw.journeys as Record<string, unknown>).build = {
      ok: false,
      actions: 2,
      note: "랙을 못 놓았다",
    };
    const read = parseMeasurements(raw);
    expect(read.journeys.build).toEqual({ ok: false, actions: 2, note: "랙을 못 놓았다" });
    expect(parseMeasurements(good())).toEqual(perfect());
  });

  test.each([
    ["not an object", () => 7, "객체가 아니다"],
    ["no journeys", () => ({ ...good(), journeys: undefined }), "journeys"],
    [
      "a journey missing",
      () => ({ ...good(), journeys: { build: { ok: true, actions: 1 } } }),
      "journeys.",
    ],
    ["a tally with more ok than tried", () => ({ ...good(), reach: { tried: 1, ok: 2 } }), "reach"],
    ["a tally of text", () => ({ ...good(), focus: "many" }), "focus"],
    ["negative counts", () => ({ ...good(), motion: { animated: -1 } }), "motion.animated"],
    ["colours not counted", () => ({ ...good(), colors: { literals: 1 } }), "colors.offToken"],
    [
      "scene not a flag",
      () => ({ ...good(), load: { kb: 1, ms: 1, sceneDrawn: "yes" } }),
      "load.sceneDrawn",
    ],
    ["load missing", () => ({ ...good(), load: undefined }), "load.sceneDrawn"],
    ["load without sizes", () => ({ ...good(), load: { sceneDrawn: true } }), "load.kb"],
    ["axe not an object", () => ({ ...good(), axe: [] }), "axe"],
  ])("rejects %s and says where", (_name, make, where) => {
    expect(() => parseMeasurements(make())).toThrow(where);
  });
});

describe("the screens speak in one friendly tone and ask for one thing at a time [REQ-058]", () => {
  test("the voice, the one main action and the button names are measured under 사용성", () => {
    const ids = scoreAll(perfect()).usable.measures.map((m) => m.id);
    expect(ids).toEqual(expect.arrayContaining(["voice", "one-thing", "buttons"]));
  });

  test("plain-form sentences lower the score, and say how many of how many", () => {
    const report = scoreAll(withChange({ voice: { tried: 200, ok: 150 } }));
    const voice = report.usable.measures.find((m) => m.id === "voice");
    expect(voice?.score).toBe(0.75);
    expect(voice?.evidence).toBe("150 / 200");
    expect(report.usable.score).toBeLessThan(100);
  });

  test("a screen with two main buttons is not 'one thing'", () => {
    const report = scoreAll(withChange({ oneThing: { tried: 10, ok: 8 } }));
    expect(report.usable.measures.find((m) => m.id === "one-thing")?.score).toBe(0.8);
  });

  test("a run that measured none of it scores nothing for it, never full marks", () => {
    const report = scoreAll(
      withChange({
        voice: { tried: 0, ok: 0 },
        oneThing: { tried: 0, ok: 0 },
        buttons: { tried: 0, ok: 0 },
      }),
    );
    for (const id of ["voice", "one-thing", "buttons"])
      expect(report.usable.measures.find((m) => m.id === id)?.score).toBe(0);
  });

  test("a measurement file without them is refused and says which part is missing", () => {
    const { voice: _voice, ...rest } = perfect();
    expect(() => parseMeasurements(rest)).toThrow("voice");
  });
});

describe("the small details are measured one by one [REQ-058]", () => {
  const find = (
    report: ReturnType<typeof scoreAll>,
    facet: "usable" | "accessible" | "credible",
    id: string,
  ) => report[facet].measures.find((m) => m.id === id);

  test("each detail sits under the face it belongs to", () => {
    const report = scoreAll(perfect());
    expect(find(report, "usable", "disabled-why")).toBeDefined();
    expect(find(report, "usable", "hover")).toBeDefined();
    expect(find(report, "accessible", "targets")).toBeDefined();
    expect(find(report, "credible", "units")).toBeDefined();
  });

  test("small controls, silent switched-off buttons, bare numbers and dead buttons each cost points", () => {
    const report = scoreAll(
      withChange({
        targets: { tried: 400, ok: 300 },
        disabledWhy: { tried: 10, ok: 5 },
        units: { tried: 80, ok: 60 },
        hover: { tried: 40, ok: 30 },
      }),
    );
    expect(find(report, "accessible", "targets")?.score).toBe(0.75);
    expect(find(report, "usable", "disabled-why")?.evidence).toBe("5 / 10");
    expect(find(report, "credible", "units")?.score).toBe(0.75);
    expect(find(report, "usable", "hover")?.score).toBe(0.75);
  });

  test("a measurement file without a detail is refused", () => {
    const { targets: _targets, ...rest } = perfect();
    expect(() => parseMeasurements(rest)).toThrow("targets");
  });
});
