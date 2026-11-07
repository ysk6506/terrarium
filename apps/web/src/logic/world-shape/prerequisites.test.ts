import { DEFAULT_SHAPE, IAP_DRAFT, type ServiceDraft } from "@terrarium/core/sources/worldgen";
import { LADDER, LAYER_IDS, type Layers, unmetOf } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { CHEAP_LAYERS, presetLayers, resolveLayers, STEADY_LAYERS } from "./auto-pick";
import { capList } from "./cap";

describe("알아서와 프리셋은 전제를 어기지 않는다 [REQ-102]", () => {
  test("프리셋 셋과 기본 모양은 모두 전제가 채워져 있다", () => {
    for (const row of [CHEAP_LAYERS, STEADY_LAYERS, presetLayers("middle"), DEFAULT_SHAPE.layers])
      expect(unmetOf(row as Layers)).toEqual([]);
  });

  test("서비스가 무엇이든, 고른 층이 무엇이든 알아서는 전제가 안 맞는 짝을 만들지 않는다", () => {
    const services: ServiceDraft[][] = [
      [IAP_DRAFT],
      [{ ...IAP_DRAFT, nodes: 1, parts: [], harm: [] }],
      [{ ...IAP_DRAFT, nodes: 5, kind: "batch", parts: [], harm: [] }],
    ];
    for (const s of services)
      for (const layer of LAYER_IDS)
        for (const chip of LADDER[layer]) {
          const r = resolveLayers(s, { [layer]: chip.id } as Partial<Layers>);
          // 사람이 고른 층이 스스로 전제를 못 채울 때만 남는다. 알아서 층이 만든 어긋남은 없어야 한다.
          const madeByAuto = unmetOf(r.layers).filter(
            (u) => !(u.layer === layer && u.chip === chip.id),
          );
          expect(madeByAuto, `${layer}=${chip.id}`).toEqual([]);
        }
  });

  test("알아서 층은 한 줄 원인만 말한다", () => {
    const { why } = resolveLayers([IAP_DRAFT], {});
    for (const text of Object.values(why)) {
      expect(text).not.toMatch(/노드\)|\(\d+개/);
      expect(text).not.toMatch(/^알아서/);
      expect(text.length).toBeLessThan(40);
    }
  });

  test("카드 목록은 셋까지만 보이고 나머지는 '외 n가지'", () => {
    expect(capList("가 · 나 · 다")).toBe("가 · 나 · 다");
    expect(capList("가 · 나 · 다 · 라 · 마")).toBe("가 · 나 · 다 · 외 2가지");
  });
});
