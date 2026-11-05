/**
 * The words outside the editor (REQ-071, ADR-0071/0073): the home page, the scoring and run labels,
 * the faults and the error a person sees when the server is gone. None uses a word the glossary retired, and none ends
 * like a report ("~니다") or like a note to an agent ("~다"): people read 해요체.
 */
import { RUN_STATUS_LABELS } from "@terrarium/core/experiments";
import { END_REASON_LABELS } from "@terrarium/core/oracle";
import { FAULT_SPECS } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { scenario as sc, world3d } from ".";
import { NETWORK_MESSAGE } from "./api";
import { PASS_RULE_TEXT, PASS_SHARE_TEXT } from "./format";
import { HEADLINES, STARTS } from "./home-copy";

/** The glossary's 쓰지 않는 말 (docs/design-docs/glossary.md). */
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

function collect(): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const add = (where: string, text: string | undefined) => {
    if (text) out.push([where, text]);
  };
  HEADLINES.forEach((h, i) => {
    add(`홈 문구 ${i} 제목`, h.title);
    add(`홈 문구 ${i} 설명`, h.lede);
  });
  for (const s of STARTS) {
    add(`홈 시작 ${s.page} 제목`, s.title);
    add(`홈 시작 ${s.page} 설명`, s.body);
  }
  for (const [k, v] of Object.entries(sc.EXPECTATION_LABELS)) add(`채점 항목 ${k}`, v);
  for (const [k, v] of Object.entries(END_REASON_LABELS)) add(`끝난 이유 ${k}`, v);
  for (const [k, v] of Object.entries(RUN_STATUS_LABELS)) add(`실행 상태 ${k}`, v);
  for (const f of FAULT_SPECS) {
    add(`고장 ${f.type} 이름`, f.label);
    add(`고장 ${f.type} 설명`, f.description);
  }
  add("합격 규칙", PASS_RULE_TEXT);
  add("합격 비율 설명", PASS_SHARE_TEXT);
  add("서버 연결 오류", NETWORK_MESSAGE);
  // The airflow map beside the 3D view (REQ-072): its labels, the line that says it is not CFD, the sentences it builds.
  for (const [k, v] of Object.entries(world3d.AIR_WORDS)) add(`공기 흐름 지도 ${k}`, v);
  add("공기 흐름 지도 안내", world3d.AIR_NOTE);
  for (const v of world3d.AIR_VIEWS) add(`공기 흐름 지도 보기 ${v.id}`, v.label);
  for (const c of [19, 24, 29, 33.1]) add(`가장 더운 곳 ${c}°C`, world3d.hottestText("A01", c));
  for (const t of [0, 30, 90, 600]) add(`돌린 시간 ${t}초`, world3d.frameText(t));
  return out;
}

describe("the words outside the editor follow the glossary [REQ-071]", () => {
  const words = collect();

  test("there is plenty to check, from the home page to the faults", () => {
    expect(words.length).toBeGreaterThan(40);
  });

  test("none of the words the glossary retired is left [REQ-071]", () => {
    const labelled = words.flatMap(([where, text]) =>
      RETIRED.filter((w) => text.includes(w)).map((w) => `${where}: '${w}' in '${text}'`),
    );
    expect(labelled).toEqual([]);
  });

  test("a sentence ends the way the app talks, not in ~니다 or ~다 [REQ-071]", () => {
    const labelled = words.flatMap(([where, text]) => {
      const last = text.trim().replace(/[.!?]$/, "");
      return /다$/.test(last) ? [`${where}: '${text}'`] : [];
    });
    expect(labelled).toEqual([]);
  });
});
