import { describe, expect, test } from "vitest";
import { HEADLINES, pickHeadline } from "./home-copy";

describe("what the home page says first [REQ-058]", () => {
  test("every line is short, plain and polite, the way the rest of the app talks (ADR-0050)", () => {
    expect(HEADLINES.length).toBeGreaterThanOrEqual(5);
    expect(new Set(HEADLINES.map((h) => h.title)).size).toBe(HEADLINES.length);
    for (const h of HEADLINES) {
      // a title takes one breath
      expect(h.title.length, h.title).toBeLessThanOrEqual(24);
      // a lede is two short sentences at most, each ending the way the app does: 해요체
      const sentences = h.lede.split(/(?<=\.)\s+/);
      expect(sentences.length, h.lede).toBeLessThanOrEqual(2);
      for (const sentence of sentences) expect(sentence, sentence).toMatch(/요\.$/);
      expect(h.lede.length, h.lede).toBeLessThanOrEqual(100);
      const text = `${h.title} ${h.lede}`;
      expect(text).not.toMatch(/합니다|입니다|[!?？！]\s*$/);
      // no boasting and no exclamation: say what the reader gets
      expect(text, text).not.toMatch(/최고|완벽|혁신|놀라운|!|공정하게/);
    }
  });

  test("each line stands on its own for someone who has never heard of Terrarium", () => {
    for (const h of HEADLINES) {
      const text = `${h.title} ${h.lede}`;
      // it says what the place is, and that an AI is what gets tried
      expect(h.lede, h.lede).toContain("가상의 데이터센터");
      expect(text, text).toContain("AI");
      expect(text, text).toContain("점수");
      // no jargon a newcomer cannot read, and "장애" said another way
      expect(text, text).not.toMatch(/장애|하네스|툴|시드|오라클/);
    }
  });

  test("none of them sells the old line: not touching real equipment is not what the product is for", () => {
    for (const h of HEADLINES) expect(h.title).not.toContain("진짜 장비를 건드리지 않고");
  });

  test("a random number picks every line in turn, and the ends of the range stay inside", () => {
    const n = HEADLINES.length;
    const seen = new Set<string>();
    for (let i = 0; i < n; i++) seen.add(pickHeadline(() => (i + 0.5) / n).title);
    expect(seen.size).toBe(n);
    expect(pickHeadline(() => 0)).toBe(HEADLINES[0]);
    expect(pickHeadline(() => 0.999999999)).toBe(HEADLINES[n - 1]);
    expect(HEADLINES).toContain(pickHeadline());
  });
});
