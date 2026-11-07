/**
 * 이끼의 찾기 품질 (REQ-103, ADR-0124). 모델 없이 찾기만 잰다: 질문의 위 세 조각에 기대한 문서가 있는가.
 * 모델이 있을 때의 답 품질은 `pnpm moss-eval`이 재요.
 */
import { describe, expect, test } from "vitest";
import {
  buildMossIndex,
  isRelevant,
  isScoringQuestion,
  SCORING_FILES,
} from "../../apps/server/src/runtime";
import { autoQuestions, DOCS_DIR, found, loadBank } from "./moss-bank";

const index = buildMossIndex(DOCS_DIR);
const rate = (qs: ReturnType<typeof loadBank>) =>
  qs.filter((q) => found(index, q)).length / qs.length;

describe("[REQ-103] 이끼의 문서 찾기", () => {
  test("the bank has a hundred questions or more, thirty of them hand-written 왜 questions", () => {
    const bank = loadBank();
    expect(bank.length).toBeGreaterThanOrEqual(100);
    expect(bank.filter((q) => q.kind === "why").length).toBeGreaterThanOrEqual(30);
    expect(
      bank.filter((q) => q.kind === "why").every((q) => q.q.includes("왜 ") && q.expect.length > 0),
    ).toBe(true);
  });

  test("the top three chunks hold the expected doc for at least 90% of the bank", () => {
    expect(rate(loadBank())).toBeGreaterThanOrEqual(0.9);
  });

  test("the same holds for questions made from the docs as they are now (the bank may be a little behind)", () => {
    expect(rate(autoQuestions(index))).toBeGreaterThanOrEqual(0.9);
  });

  test("the hand-written 왜 questions alone find their doc at least 80% of the time (the harder half)", () => {
    expect(rate(loadBank().filter((q) => q.kind === "why"))).toBeGreaterThanOrEqual(0.8);
  });

  test("every hand-written 왜 question about a score finds its scoring doc in the top three (the scoring boost, ADR-0125)", () => {
    const scoring = loadBank().filter(
      (q) =>
        q.kind === "why" && isScoringQuestion(q.q) && q.expect.some((f) => SCORING_FILES.has(f)),
    );
    expect(scoring.length).toBeGreaterThanOrEqual(6);
    expect(scoring.filter((q) => !found(index, q)).map((q) => q.q)).toEqual([]);
    const asked = index.search("이 실행이 왜 18.2점이에요?", 3);
    expect(asked.some((h) => h.chunk.file === "docs/design-docs/measurement.md")).toBe(true);
  });

  test("a question about something the docs never mention finds nothing worth citing", () => {
    for (const q of [
      "양자 컴퓨터로 김치찌개 끓이는 법",
      "오늘 날씨 어때?",
      "비트코인 가격 알려줘",
      "축구 월드컵 우승국이 어디야",
    ]) {
      const top = index.search(q, 1)[0];
      expect(top && isRelevant(top)).toBeFalsy();
    }
    const asked = index.search("이 실행이 왜 30점이에요?", 1)[0];
    expect(asked && isRelevant(asked)).toBe(true);
  });

  test("exec-plans are not in the index, ADRs and mockups are", () => {
    const files = new Set(index.chunks.map((c) => c.file));
    expect([...files].some((f) => f.includes("exec-plans"))).toBe(false);
    expect([...files].some((f) => f.includes("/adr/"))).toBe(true);
    expect([...files].some((f) => f.includes("/mockups/"))).toBe(true);
  });
});
