/**
 * The sentences the simulator's alarms are written with (REQ-071, ADR-0071/0073). They are written in code, not in a
 * table, so this reads the sources: no word the glossary retired, and every sentence ends in 해요체 (or is a plain noun
 * phrase), never in ~니다 or ~다.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const PHYSICS = resolve(__dirname, "../../packages/core/src/physics");
const FILES = ["net-alarms.ts", "alarms.ts", "plant-alarms.ts"];
const RETIRED = [
  "도구",
  "삭제",
  "수정",
  "취소",
  "월드",
  "배점",
  "까닭",
  "경보",
  "가동",
  "한도",
  "노출",
  "장애",
  "주입",
];

/** Korean literals of a source file, comments left out. */
function literalsOf(file: string): string[] {
  const code = readFileSync(resolve(PHYSICS, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  return (code.match(/(["'`])(?:\\.|(?!\1)[^\\])*\1/g) ?? []).filter((s) => /[가-힣]/.test(s));
}

/** The Korean word a literal ends on, wherever a literal ends in Korean. */
const endings = (literal: string): string[] =>
  [...literal.matchAll(/([가-힣]+)[.!?]?["'`]/g)].map((m) => m[1] as string);

describe("the alarm sentences follow the glossary [REQ-071]", () => {
  test("there are sentences to check in every file", () => {
    for (const file of FILES) expect(literalsOf(file).length, file).toBeGreaterThan(3);
  });

  test("none of the words the glossary retired is in them", () => {
    const found = FILES.flatMap((file) =>
      literalsOf(file).flatMap((text) =>
        RETIRED.filter((w) => text.includes(w)).map((w) => `${file}: '${w}' in ${text}`),
      ),
    );
    expect(found).toEqual([]);
  });

  test("none ends in ~니다 or ~다, and the network alarms say 'ㅇㅇ하지 않아요'", () => {
    const found = FILES.flatMap((file) =>
      literalsOf(file).flatMap((text) =>
        endings(text)
          .filter((w) => w.endsWith("다"))
          .map((w) => `${file}: '${w}' ends ${text}`),
      ),
    );
    expect(found).toEqual([]);
    expect(literalsOf("net-alarms.ts").join("\n")).toContain("응답하지 않아요");
  });
});
