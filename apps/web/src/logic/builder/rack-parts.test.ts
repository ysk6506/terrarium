import { Catalog } from "@terrarium/core/catalog";
import {
  DEFAULT_SHAPE,
  defaultSize,
  generateShaped,
  planShape,
  sizeFields,
} from "@terrarium/core/sources/worldgen";
import { BlueprintIndex } from "@terrarium/core/world";
import { describe, expect, it } from "vitest";
import { sizeView } from "../world-shape/size-view";
import { barSum, factLine } from "./one-card";
import { levelStats } from "./stats";

describe("빌더 아래 막대의 랙·서버는 ③의 합계와 같다 [REQ-111]", () => {
  const catalog = new Catalog();
  const spec = { ...DEFAULT_SHAPE, ...sizeFields(defaultSize(DEFAULT_SHAPE.services)) };
  const index = new BlueprintIndex(generateShaped(spec, catalog).blueprint);
  const level = { kind: "site" } as const;

  it("[REQ-111] 막대는 '랙 7대 (서버 랙 6 + 기반 랙 1) · 서버 120대'라고 말한다", () => {
    const screen = sizeView({
      services: spec.services,
      size: defaultSize(spec.services),
      start: defaultSize(spec.services),
      plan: planShape(spec),
    });
    const stats = levelStats(index, catalog, level);
    expect(stats.racks).toBe(screen.totals.racks);
    expect(stats.baseRacks).toBe(screen.totals.baseRacks);
    expect(stats.servers).toBe(screen.totals.servers);
    const parts = barSum(index, catalog, level, undefined);
    const racks = parts.find((p) => p.label === "랙");
    expect(racks?.value).toBe(`${screen.totals.racks}대`);
    expect(racks?.note).toBe(
      `(서버 랙 ${screen.totals.racks - screen.totals.baseRacks} + 기반 랙 ${screen.totals.baseRacks})`,
    );
    expect(parts.find((p) => p.label === "서버")?.value).toBe(`${screen.totals.servers}대`);
  });

  it("[REQ-111] 서버룸을 고르면 그 카드도 같은 말로 센다", () => {
    const room = index.ofKind("room")[0];
    if (!room) throw new Error("room");
    expect(factLine(index, catalog, room)).toMatch(
      /랙 7대 \(서버 랙 6 \+ 기반 랙 1\) · 서버 120대/,
    );
  });
});
