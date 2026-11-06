import type { RunEvent } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { operationWords, statusLabel } from ".";

describe("words for how an operation stands and how it went on [REQ-090]", () => {
  test("a person's stop is 멈춤(사람) in an operation and 멈춤 anywhere else", () => {
    expect(statusLabel("cancelled", true)).toBe("멈춤(사람)");
    expect(statusLabel("cancelled")).toBe("멈춤");
    expect(statusLabel("completed", true)).toBe("완료");
    expect(statusLabel("failed", true)).toBe("실패");
  });

  test("a run picked up after the server stopped says how long it stood still", () => {
    const resumed = (gapSeconds: number): RunEvent =>
      ({ kind: "link", seq: 0, t: 100, what: "resumed", gapSeconds }) as RunEvent;
    const lost = { kind: "link", seq: 1, t: 100, what: "lost" } as RunEvent;
    expect(operationWords.resumeNotes([lost])).toEqual([]);
    expect(operationWords.resumeNotes([resumed(180)])[0]).toContain(
      "서버가 다시 시작돼 3분 뒤 이어 갔어요",
    );
    expect(operationWords.resumeNotes([resumed(20)])[0]).toContain("20초 뒤");
    expect(operationWords.resumeNotes([resumed(7200)])[0]).toContain("2시간 뒤");
    expect(operationWords.resumeNotes([resumed(60), resumed(600)])).toHaveLength(2);
  });
});
