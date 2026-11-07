import { problemName } from "@terrarium/core/scenario";
import { draftFromCard, IAP_DRAFT, type ServiceDraft } from "@terrarium/core/sources/worldgen";
import { chipById, LADDER, type Layers, SERVICE_CATALOG, unmetOf } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { presetLayers, resolveLayers, STEADY_LAYERS } from "./auto-pick";
import { cardOf } from "./ladders";

const NEW = [
  ...LADDER.accel.map((c) => c.id),
  "pwr-n1-ups",
  "pwr-rack-bbu",
  "pwr-substation",
  "cool-rdhx",
  "cool-immersion",
];

const draftOf = (name: string): ServiceDraft => {
  const card = SERVICE_CATALOG.find((c) => c.name === name);
  if (!card) throw new Error(name);
  return draftFromCard(card, []);
};

describe("가속기·전원·냉방 새 칩의 카드 [REQ-107]", () => {
  for (const id of NEW) {
    test(`${id}: 실선이고 카드가 있고 '생기는 고장'은 셋 이하이며 칩의 고장 목록 안에 있다`, () => {
      const chip = chipById(id);
      expect(chip?.modeled).toBe(true);
      const card = cardOf(id);
      expect(card).toBeDefined();
      const items = (card?.faults ?? "").split(" · ");
      expect(items.length).toBeLessThanOrEqual(3);
      if (id === "gpu-none") return;
      const names = [...(chip?.stops ?? []), ...(chip?.slows ?? [])].map(problemName);
      for (const item of items) expect(names, item).toContain(item);
    });
  }

  test("점선이 하나도 없다", () => {
    expect(LADDER.accel.every((c) => c.modeled)).toBe(true);
  });
});

describe("알아서와 프리셋은 GPU 층을 이렇게 고른다 [REQ-107]", () => {
  test("GPU 카드가 아니면 알아서는 gpu-none", () => {
    expect(resolveLayers([IAP_DRAFT], {}).layers.accel).toBe("gpu-none");
  });

  test("AI 추론 서빙은 추론 풀, 학습 파이프라인은 학습 클러스터를 고르고 이유를 말한다", () => {
    const serving = resolveLayers([draftOf("AI 추론 서빙")], {});
    expect(serving.layers.accel).toBe("gpu-serving-pool");
    expect(serving.why.accel).toMatch(/해서$|라서$/);
    const training = resolveLayers([draftOf("학습 파이프라인")], {});
    expect(training.layers.accel).toBe("gpu-training-cluster");
    expect(training.layers.network).toBe("net-leaf-spine");
  });

  test("GPU는 건물 하나의 것이라 더 비싼 서비스가 함께 있어도 GPU 카드의 선택이 이긴다", () => {
    const both = resolveLayers([IAP_DRAFT, draftOf("학습 파이프라인")], {});
    expect(both.layers.accel).toBe("gpu-training-cluster");
    expect(both.why.accel).toContain("학습 파이프라인");
    const mixed = resolveLayers([draftOf("AI 추론 서빙"), draftOf("학습 파이프라인")], {});
    expect(mixed.layers.accel).toBe("gpu-training-cluster");
  });

  test("멈추지 않게는 선행 조건을 어기지 않고, 싸게는 GPU 없이", () => {
    expect(unmetOf(STEADY_LAYERS as Layers)).toEqual([]);
    expect(STEADY_LAYERS.accel).toBe("gpu-none");
    expect(presetLayers("cheap")?.accel).toBe("gpu-none");
  });

  test("학습 클러스터는 사람이 고른 낮은 네트워크 위에서는 알아서가 아니라 요구로 남는다", () => {
    const r = resolveLayers([draftOf("학습 파이프라인")], { network: "net-three-tier" });
    expect(r.layers.network).toBe("net-three-tier");
    expect(
      unmetOf(r.layers as Layers).length + (r.layers.accel === "gpu-training-cluster" ? 0 : 1),
    ).toBeGreaterThan(0);
  });
});
