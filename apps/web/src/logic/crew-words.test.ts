/**
 * What the people in the server room say (REQ-074, ADR-0078): every line keeps to the glossary, talks in
 * 해요체, has no emoji, no exclamation mark and no name, and never says that anything was fixed.
 */
import { describe, expect, test } from "vitest";
import { world3d } from ".";

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
/** Words that would claim the person changed the world. */
const CLAIMS = ["고쳤", "고쳐 놨", "복구했", "해결했", "복구됐", "해결됐", "다 됐"];

const lines = Object.entries(world3d.CREW_LINES).flatMap(([situation, list]) =>
  list.map((text) => [situation, text] as const),
);

describe("the lines of the people in the server room [REQ-074]", () => {
  test("there are 3 to 5 for each of the six situations", () => {
    expect(Object.keys(world3d.CREW_LINES)).toHaveLength(6);
    expect(lines.length).toBeGreaterThanOrEqual(18);
  });

  test("none uses a word the glossary retired, and none ends like a report [REQ-074]", () => {
    for (const [where, text] of lines) {
      for (const w of RETIRED) expect(text, `${where}: ${text}`).not.toContain(w);
      expect(/다$/.test(text.trim().replace(/[.?]$/, "")), `${where}: ${text}`).toBe(false);
    }
  });

  test("light but plain: no emoji, no exclamation, no name, no claim to have fixed anything [REQ-074]", () => {
    for (const [where, text] of lines) {
      expect(text, where).not.toMatch(/!|！/);
      expect(text, where).not.toMatch(/\p{Extended_Pictographic}/u);
      for (const c of CLAIMS) expect(text, `${where}: ${text}`).not.toContain(c);
      expect(text, where).not.toMatch(/님|씨\b|삼성|Samsung/);
    }
  });

  test("a line that names the machine is whole with a name and without one [REQ-074]", () => {
    for (const situation of Object.keys(world3d.CREW_LINES) as world3d.CrewSituation[])
      for (let n = 0; n < 6; n++) {
        const named = world3d.lineFor({ id: 2 }, situation, n, "CRAH-1F-A-1");
        const bare = world3d.lineFor({ id: 2 }, situation, n);
        expect(named).not.toContain("{");
        expect(bare).not.toContain("{");
      }
  });
});
