import type { AuditEntryView } from "@terrarium/core/contract";
import { describe, expect, test } from "vitest";
import {
  atText,
  changeLines,
  draws,
  entryLine,
  fileName,
  kindWord,
  NO_FILTERS,
  narrowed,
  pageLine,
  queryOf,
  reasonGiven,
  targetText,
} from "./audit-screen";

const entry = (over: Partial<AuditEntryView> = {}): AuditEntryView =>
  ({
    seq: 1,
    at: "2026-11-12T05:03:00.000Z",
    subject: { id: "haneul", name: "김하늘", kind: "person", admin: false },
    action: "scope.change",
    label: "누가 볼 수 있나요를 바꿨어요",
    outcome: "allowed",
    resource: { kind: "scenario", id: "s1", name: "팬 고장" },
    ...over,
  }) as AuditEntryView;

describe("the audit screen reads in words [REQ-054]", () => {
  test("[REQ-054] filters become a request: a week by default, and what is chosen", () => {
    const now = Date.parse("2026-11-12T00:00:00.000Z");
    expect(queryOf(NO_FILTERS, now)).toEqual({ from: "2026-11-05T00:00:00.000Z" });
    expect(
      queryOf(
        { period: "all", outcome: "denied", subject: "minsu", action: "", kind: "model" },
        now,
      ),
    ).toEqual({ outcome: "denied", subject: "minsu", resourceKind: "model" });
    expect(narrowed(NO_FILTERS)).toBe(false);
    expect(narrowed({ ...NO_FILTERS, outcome: "denied" })).toBe(true);
    expect(narrowed({ ...NO_FILTERS, period: "day" })).toBe(true);
  });

  test("[REQ-054] a file is named by the day", () => {
    expect(fileName(Date.parse("2026-11-12T10:00:00Z"))).toBe("terrarium-audit-2026-11-12.jsonl");
  });

  test("[REQ-054] an entry names what it was about, and a kind it does not know as written", () => {
    expect(targetText(entry())).toBe("시나리오 '팬 고장'");
    expect(targetText(entry({ resource: { kind: "model" } as AuditEntryView["resource"] }))).toBe(
      "모델",
    );
    expect(kindWord("something_new")).toBe("something_new");
  });

  test("[REQ-054] a change reads as before and after, and a reason is found only when it is text", () => {
    const changed = entry({
      changes: [{ field: "scope", before: "everyone", after: "private" }],
    } as Partial<AuditEntryView>);
    expect(changeLines(changed)).toEqual(["누가 볼 수 있나요: 모두 → 나만"]);
    expect(changeLines(entry())).toEqual([]);
    expect(reasonGiven(entry({ detail: { reason: "담당 변경" } }))).toBe("담당 변경");
    expect(reasonGiven(entry({ detail: { reason: 3 } }))).toBeUndefined();
    expect(reasonGiven(entry())).toBeUndefined();
  });

  test("[REQ-054] a refusal draws the eye, and the line can be read aloud", () => {
    expect(draws(entry({ outcome: "denied" }))).toBe(true);
    expect(draws(entry())).toBe(false);
    expect(entryLine(entry({ outcome: "denied" }))).toBe(
      "김하늘 · 누가 볼 수 있나요를 바꿨어요 · 막혔어요",
    );
  });

  test("[REQ-054] the page says how many lines and whether more wait", () => {
    expect(pageLine(0, false)).toBe("조건에 맞는 기록이 없어요");
    expect(pageLine(50, true)).toContain("더 있어요");
    expect(pageLine(3, false)).toBe("3줄이에요");
    expect(atText("not a date")).toBe("not a date");
    expect(atText("2026-11-12T05:03:00")).toMatch(/^11월 12일 \d\d:\d\d$/);
  });
});
