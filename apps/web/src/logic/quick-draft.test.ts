import { describe, expect, it } from "vitest";
import { sampleBlueprint } from "../../../../packages/core/src/world/test-support/sample";
import { quickDraft, quickOperation } from "./quick-draft";
import { QUICK } from "./world-shape/short-flow";

describe("바꾸기는 실험 시작과 같은 값으로 열린다 [REQ-104]", () => {
  it("[REQ-104] 5번, 기본 툴 + events_since, 실제 시간, 시나리오 세트", () => {
    const op = quickOperation(sampleBlueprint());
    expect(op?.source.kind).toBe("set");
    expect(op?.pace).toEqual({ mode: "realtime" });
    expect(op?.hours).toBe(QUICK.hours);
    const d = quickDraft("w1", op);
    expect(d.runs).toBe(5);
    expect(d.tools).toContain("events_since");
    expect(d.harnessId).toBe("builtin");
    expect(d.agentId).toBe("operator");
  });

  it("[REQ-104] 고른 시나리오만 쓰면 고장이 줄고, 없는 이름이면 운영을 만들지 않는다", () => {
    const all = quickOperation(sampleBlueprint());
    const one = quickOperation(sampleBlueprint(), ["cooling-failure"]);
    const faults = (o: typeof all) => (o?.source.kind === "set" ? o.source.faults.length : 0);
    expect(faults(one)).toBeGreaterThan(0);
    expect(faults(one)).toBeLessThan(faults(all));
    expect(quickOperation(sampleBlueprint(), ["nope"])).toBeUndefined();
  });
});
