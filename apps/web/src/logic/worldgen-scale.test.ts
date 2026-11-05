import { MAX_CAMPUS_RACKS, SITE_PRESETS } from "@terrarium/core/sources/worldgen";
import { describe, expect, test } from "vitest";
import {
  DEFAULT_SCALE,
  DETAIL_GROUPS,
  keptValue,
  makeLabel,
  roughly,
  SCALE_LABELS,
  STAGES,
  scaleChoices,
  scaleSpec,
  shownValue,
  sizeOf,
  sizeText,
  specProblem,
  stageAt,
  waitText,
} from "./worldgen-scale";

describe("a world is chosen by its result, not by fourteen numbers [REQ-077]", () => {
  test("every site offers small, medium and as-it-really-is, each bigger than the last", () => {
    for (const site of SITE_PRESETS) {
      const choices = scaleChoices(site.id);
      expect(choices.at(-1)?.id).toBe("real");
      const racks = choices.map((c) => c.size.racks);
      expect([...racks].sort((a, b) => a - b)).toEqual(racks);
      expect(new Set(racks).size).toBe(racks.length);
    }
    expect(scaleChoices("hwaseong").map((c) => c.id)).toEqual(["small", "medium", "real"]);
    expect(SCALE_LABELS.real).toBe("실제 그대로");
    expect(DEFAULT_SCALE).toBe("medium");
  });

  test("the real scale is the site's own mix, and it reads as the site's size", () => {
    const real = scaleChoices("hwaseong").find((c) => c.id === "real");
    expect(real?.spec).toMatchObject({ site: "hwaseong", seed: 1 });
    expect(real?.result).toMatch(
      /^랙 [\d,]+대 · 서버 약 [\d,]+대 · 전력 약 \d+ MW — 실제 화성사업장 규모예요$/,
    );
    expect(real?.about).toMatch(/^랙 [\d,]+대 · 약 1분$/);
  });

  test("smaller scales say how much of the real one they are, or that they are light", () => {
    const [small, medium] = scaleChoices("hwaseong");
    expect(medium?.result).toMatch(/— 실제의 \d+%쯤이에요$/);
    expect(small?.result).toMatch(/— 가볍게 돌려 보기 좋아요$/);
  });

  test("a scale that is not smaller than a bigger one is left out, so the choices never repeat or go out of order", () => {
    expect(scaleChoices("suwon").map((c) => c.id)).toEqual(["medium", "real"]);
    expect(scaleChoices("onyang").map((c) => c.id)).toEqual(["medium", "real"]);
    expect(scaleChoices("pyeongtaek").map((c) => c.id)).toEqual(["small", "medium", "real"]);
  });

  test("the numbers are rounded the way a person says them, and the wait is in words", () => {
    expect(roughly(185_568)).toBe(190_000);
    expect(roughly(58)).toBe(58);
    expect(sizeText(sizeOf(scaleSpec("hwaseong", "small")))).toMatch(/^랙 [\d,]+대 · 서버 약 /);
    expect([waitText(100), waitText(1000), waitText(5000), waitText(15_000)]).toEqual([
      "몇 초",
      "약 10초",
      "약 30초",
      "약 1분",
    ]);
  });

  test("the button says what it makes; a spec the world cannot hold says why", () => {
    expect(makeLabel("hwaseong")).toBe("화성사업장 만들기");
    expect(specProblem(scaleSpec("hwaseong", "real"))).toBeUndefined();
    expect(specProblem({ ...scaleSpec("hwaseong", "real"), buildings: 99999 })).toMatch(
      /0~\d+ 사이의 정수/,
    );
    const huge = {
      ...scaleSpec("hwaseong", "real"),
      podsPerHall: 240,
      hallsPerFloor: 4,
      floors: 12,
    };
    expect(specProblem(huge)).toMatch(
      new RegExp(`${MAX_CAMPUS_RACKS.toLocaleString("en-US")}대까지`),
    );
  });

  test("the numbers under 더 정하기 are three groups with a line each, and a percent is typed as a percent", () => {
    expect(DETAIL_GROUPS.map((g) => g.title)).toEqual(["건물", "서버룸", "서버"]);
    const fields = DETAIL_GROUPS.flatMap((g) => g.fields);
    for (const f of fields) {
      expect(f.help).toMatch(/요\.$/);
      expect(f.label).not.toMatch(/홀|비율|컨테인먼트 수/);
    }
    const fill = fields.find((f) => f.key === "fill");
    expect(fill && shownValue(fill, { ...scaleSpec("hwaseong", "real"), fill: 0.55 })).toBe(55);
    expect(fill && keptValue(fill, 55)).toBeCloseTo(0.55);
    const floors = fields.find((f) => f.key === "floors");
    expect(floors && keptValue(floors, 3.4)).toBe(3);
    expect(fields.map((f) => f.key)).not.toContain("detailedShare");
  });

  test("while the world is made, the words follow the time: three stages, in order", () => {
    expect(STAGES).toEqual(["사업장 짓는 중", "서버룸 채우는 중", "거의 다 됐어요"]);
    const racks = 5000;
    expect(stageAt(0, racks)).toBe(STAGES[0]);
    expect(stageAt(12_000, racks)).toBe(STAGES[1]);
    expect(stageAt(60_000, racks)).toBe(STAGES[2]);
  });
});
