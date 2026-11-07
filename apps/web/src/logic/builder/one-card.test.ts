import { Catalog } from "@terrarium/core/catalog";
import { describe, expect, test } from "vitest";
import { trialLabel } from "./one-card";
import { placeKinds, placeTexts } from "./place";

const catalog = new Catalog();
const view = { buildings: 1, forSale: 0, rooms: 1, roomFull: false };

describe("직접 짓기 둘레: 놓기 하나, 카드 하나, 시운전 [REQ-102]", () => {
  test("서버룸 안의 놓기 목록은 랙·냉방기·전기 설비만 보여 준다", () => {
    const kinds = placeKinds({ kind: "room", id: "r1" }, catalog, view);
    const titles = kinds.map((k) => k.title);
    expect(titles).toContain("랙");
    expect(titles).toContain("냉방기");
    expect(titles).toContain("전기 설비");
    expect(titles).not.toContain("땅 사기");
    for (const k of kinds) expect(k.line.length).toBeGreaterThan(0);
  });

  test("놓기 목록의 글에는 '장애'나 '돌려 보기'가 없다", () => {
    const kinds = placeKinds({ kind: "room", id: "r1" }, catalog, view);
    expect(placeTexts(kinds).join(" ")).not.toMatch(/장애|돌려 보/);
  });

  test("시운전 버튼의 말은 하기 전, 하는 중, 한 뒤로 바뀐다", () => {
    expect(trialLabel({ previewing: false, minutes: 0, done: false })).toBe("시운전 10분");
    expect(trialLabel({ previewing: true, minutes: 3, done: false })).toBe("시운전 중 3/10분");
    expect(trialLabel({ previewing: false, minutes: 10, done: true })).toBe("다시 시운전");
  });
});
