import { describe, expect, it } from "vitest";
import { advance, pressesToExperiment, retreat, START } from "./short-flow";

describe("서비스부터 짧게 [REQ-104]", () => {
  it("[REQ-104] 입구 문 하나, 다음 둘, 실험 시작 하나: IAP만 있으면 클릭 넷이다", () => {
    expect(pressesToExperiment(1)).toBe(4);
  });

  it("[REQ-104] 서비스를 더하면 하나마다 ②를 한 번 더 지나서 클릭이 하나씩 는다", () => {
    expect(pressesToExperiment(2)).toBe(5);
    expect(pressesToExperiment(3)).toBe(6);
  });

  it("[REQ-104] 화면은 셋뿐이고 ③에서 다음은 만들기(실험 시작)다", () => {
    const seen = new Set<string>([START.step]);
    let at = START;
    for (;;) {
      const next = advance(at, 1);
      if (next === "make") break;
      at = next;
      seen.add(at.step);
    }
    expect([...seen]).toEqual(["services", "ladders", "size"]);
  });

  it("[REQ-104] 이전은 한 화면씩 거꾸로 걷고, ①에서는 나간다", () => {
    expect(retreat({ step: "size", ladder: 0 }, 1)).toEqual({ step: "ladders", ladder: 0 });
    expect(retreat({ step: "ladders", ladder: 0 }, 1)).toEqual({ step: "services", ladder: 0 });
    expect(retreat(START, 1)).toBe("leave");
  });
});
