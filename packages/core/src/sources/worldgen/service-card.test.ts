import { SERVICE_CATALOG } from "@terrarium/core/world";
import { describe, expect, it } from "vitest";
import {
  cardOfKey,
  catalogKey,
  DEFAULT_SHAPE,
  draftFromCard,
  generateShaped,
  shapeProblem,
} from "./index";

describe("서비스 카탈로그 [REQ-104]", () => {
  it("[REQ-104] 기본 제공 카드는 열 장이고 번호가 겹치지 않는다", () => {
    expect(SERVICE_CATALOG).toHaveLength(10);
    expect(new Set(SERVICE_CATALOG.map((c) => c.id)).size).toBe(10);
    expect(SERVICE_CATALOG.map((c) => c.name)).toEqual([
      "웹 API",
      "배치 파이프라인",
      "데이터베이스 뒤의 앱",
      "쿠버네티스 플랫폼",
      "메시지 큐",
      "캐시",
      "AI 추론 서빙",
      "학습 파이프라인",
      "파일 공유",
      "모니터링",
    ]);
  });

  it("[REQ-104] 카드마다 부분의 합이 노드·호스트·스위치 수와 같고, 돈은 한 줄 설명에 없다", () => {
    for (const c of SERVICE_CATALOG) {
      const sum = (role: string) =>
        c.parts.filter((p) => p.role === role).reduce((n, p) => n + (p.count ?? 1), 0);
      expect(sum("node"), c.id).toBe(c.nodes);
      expect(sum("host"), c.id).toBe(c.hosts);
      expect(sum("switch"), c.id).toBe(c.switches);
      expect(c.tiers.length, c.id).toBeGreaterThan(0);
      expect(c.line, c.id).not.toMatch(/원|만 원|억/);
      expect(c.matters.length, c.id).toBeGreaterThan(0);
      for (const call of c.calls) expect(SERVICE_CATALOG.some((x) => x.id === call)).toBe(true);
    }
  });

  it("[REQ-104] 카드마다 IAP와 함께 있어도 세계가 지어진다", () => {
    for (const c of SERVICE_CATALOG) {
      const spec = {
        ...DEFAULT_SHAPE,
        services: [...DEFAULT_SHAPE.services, draftFromCard(c, ["iap"])],
      };
      expect(shapeProblem(spec), c.id).toBeUndefined();
      const built = generateShaped(spec);
      expect(built.counts.serviceVms, c.id).toBeGreaterThanOrEqual(9 + c.nodes);
    }
  });

  it("[REQ-104] 같은 카드를 또 고르면 번호가 붙고, 부르는 카드는 이미 있을 때만 이어진다", () => {
    expect(catalogKey("cache", ["cache"])).toBe("cache-2");
    expect(catalogKey("cache", ["cache", "cache-2"])).toBe("cache-3");
    expect(cardOfKey("cache-2")).toBe("cache");
    const ai = SERVICE_CATALOG.find((c) => c.id === "ai-serving");
    if (!ai) throw new Error("AI 추론 서빙 카드가 없어요");
    expect(draftFromCard(ai, ["iap"]).calls).toBeUndefined();
    expect(draftFromCard(ai, ["iap", "cache"]).calls).toEqual(["cache"]);
  });

  it("[REQ-104] 저장한 카드는 이름과 피해 숫자만 바꾸고, 등급 수가 다르면 카드의 것을 쓴다", () => {
    const web = SERVICE_CATALOG[0];
    if (!web) throw new Error("카드가 없어요");
    const mine = draftFromCard(web, [], {
      name: "내 API",
      harm: [
        { name: "a", perHourKrw: 1 },
        { name: "b", perHourKrw: 2 },
      ],
    });
    expect(mine.name).toBe("내 API");
    expect(mine.harm.map((h) => h.perHourKrw)).toEqual([1, 2]);
    expect(mine.nodes).toBe(web.nodes);
    expect(draftFromCard(web, [], { harm: [{ name: "a", perHourKrw: 1 }] }).harm).toHaveLength(2);
  });
});
