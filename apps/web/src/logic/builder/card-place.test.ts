import { describe, expect, it } from "vitest";
import {
  anchorStore,
  BAR_HEIGHT,
  CARD_MARGIN,
  cardWidth,
  placeCard,
  SHEET_BELOW,
} from "./card-place";

const STAGES = [
  { vw: 1440, stage: { w: 1356, h: 828 } },
  { vw: 1280, stage: { w: 1196, h: 828 } },
  { vw: 1024, stage: { w: 940, h: 828 } },
  { vw: 900, stage: { w: 816, h: 760 } },
];
const CARDS = [
  { w: 320, h: 235 },
  { w: 320, h: 560 },
  { w: 240, h: 300 },
];

describe("카드 자리 [REQ-109]", () => {
  it("[REQ-109] 어디를 가리켜도 카드는 스테이지 안, 가장자리에서 16px 이상 떨어진다", () => {
    let n = 0;
    for (const { vw, stage } of STAGES)
      for (const card of CARDS)
        for (let x = -50; x <= stage.w + 50; x += 83)
          for (let y = -50; y <= stage.h + 50; y += 71)
            for (const mode of ["beside", "below"] as const) {
              const p = placeCard({ anchor: { x, y }, stage, card, viewport: vw, mode });
              expect(p.sheet).toBe(false);
              expect(p.left).toBeGreaterThanOrEqual(CARD_MARGIN);
              expect(p.left + card.w).toBeLessThanOrEqual(stage.w - CARD_MARGIN);
              expect(p.top).toBeGreaterThanOrEqual(CARD_MARGIN);
              expect(p.top + card.h).toBeLessThanOrEqual(stage.h - CARD_MARGIN - BAR_HEIGHT);
              n++;
            }
    expect(n).toBeGreaterThan(1_000);
  });

  it("[REQ-109] 물건의 오른쪽에 자리가 있으면 오른쪽에, 없으면 왼쪽에 열려 물건을 덮지 않는다", () => {
    const stage = { w: 1200, h: 800 };
    const card = { w: 320, h: 240 };
    const right = placeCard({ anchor: { x: 300, y: 400 }, stage, card, viewport: 1440 });
    expect(right.left).toBeGreaterThan(300);
    const left = placeCard({ anchor: { x: 1000, y: 400 }, stage, card, viewport: 1440 });
    expect(left.left + card.w).toBeLessThan(1000);
  });

  it("[REQ-109] 놓기 시트는 버튼 바로 밑 모서리에 열린다", () => {
    const p = placeCard({
      anchor: { x: 20, y: 72 },
      stage: { w: 1356, h: 828 },
      card: { w: 240, h: 300 },
      viewport: 1440,
      mode: "below",
    });
    expect(p).toEqual({ left: 20, top: 72, sheet: false });
  });

  it("[REQ-109] 고른 것이 없거나 보이지 않으면 위 오른쪽에 둔다", () => {
    const p = placeCard({
      anchor: undefined,
      stage: { w: 1000, h: 700 },
      card: { w: 320, h: 200 },
      viewport: 1440,
    });
    expect(p).toEqual({ left: 1000 - 320 - CARD_MARGIN, top: CARD_MARGIN, sheet: false });
  });

  it("[REQ-109] 900px 아래에서는 아래 시트가 되고, 너비는 min(320, 스테이지 - 32)다", () => {
    expect(SHEET_BELOW).toBe(900);
    for (const vw of [390, 640, 899])
      expect(
        placeCard({
          anchor: { x: 100, y: 100 },
          stage: { w: vw, h: 600 },
          card: { w: 300, h: 200 },
          viewport: vw,
        }).sheet,
      ).toBe(true);
    expect(cardWidth(1356)).toBe(320);
    expect(cardWidth(340)).toBe(308);
    expect(cardWidth(300)).toBe(268);
  });

  it("[REQ-109] 좁은 스테이지에서도 카드가 넘치지 않는다 (카드가 스테이지보다 넓어도 왼쪽 16px에 붙는다)", () => {
    const p = placeCard({
      anchor: { x: 200, y: 200 },
      stage: { w: 300, h: 600 },
      card: { w: 320, h: 200 },
      viewport: 1000,
    });
    expect(p.left).toBe(CARD_MARGIN);
  });

  it("[REQ-109] 자리 저장소는 같은 자리를 다시 넣어도 알리지 않고, 바뀌면 알린다", () => {
    const store = anchorStore();
    let calls = 0;
    const off = store.subscribe(() => calls++);
    store.set({ x: 1, y: 2 });
    store.set({ x: 1, y: 2 });
    store.set({ x: 3, y: 2 });
    store.set(undefined);
    store.set(undefined);
    expect(calls).toBe(3);
    off();
    store.set({ x: 9, y: 9 });
    expect(calls).toBe(3);
  });
});
