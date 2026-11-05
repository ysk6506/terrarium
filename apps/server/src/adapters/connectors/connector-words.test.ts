/**
 * What the connection form says (REQ-071, ADR-0071/0073): each connector describes itself in words a person reads, so
 * none uses a word the glossary retired, and none ends like a report ("~니다") or like a note to an agent ("~다").
 */
import { describe, expect, test } from "vitest";
import { CONNECTORS } from "./index";

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
  "닿",
];

function words(): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const { spec } of CONNECTORS) {
    out.push([`${spec.kind} 이름`, spec.label], [`${spec.kind} 설명`, spec.description]);
    spec.toolGuide.forEach((g, i) => {
      out.push([`${spec.kind} 안내 ${i + 1}`, g]);
    });
    for (const f of spec.fields) {
      out.push([`${spec.kind}.${f.key} 이름`, f.label]);
      if (f.help) out.push([`${spec.kind}.${f.key} 도움말`, f.help]);
    }
  }
  return out;
}

describe("the connection form's words follow the glossary [REQ-071]", () => {
  const all = words();

  test("there is plenty to check", () => {
    expect(all.length).toBeGreaterThan(80);
  });

  test("none of the words the glossary retired is left", () => {
    const found = all.flatMap(([where, text]) =>
      RETIRED.filter((w) => text.includes(w)).map((w) => `${where}: '${w}' in '${text}'`),
    );
    expect(found).toEqual([]);
  });

  test("a sentence ends in 해요체, not in ~니다 or ~다", () => {
    const found = all
      .filter(([, text]) => /다[.!?]?$/.test(text.trim()))
      .map(([w, t]) => `${w}: '${t}'`);
    expect(found).toEqual([]);
  });
});
