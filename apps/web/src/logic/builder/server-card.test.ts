import { Catalog } from "@terrarium/core/catalog";
import { DEFAULT_SHAPE, generateShaped } from "@terrarium/core/sources/worldgen";
import { BlueprintIndex } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { insertOptions, serverFacts, stepSum } from "./server-card";

const catalog = new Catalog();
const world = generateShaped({ ...DEFAULT_SHAPE, servers: 48 }).blueprint;
const index = new BlueprintIndex(world);

describe("직접 짓기 카드 [REQ-094]", () => {
  test("서버 넣기는 종류 셋을 가격·전력과 함께 보인다", () => {
    const rack = index.ofKind("rack")[1];
    const options = insertOptions(catalog, rack as never);
    expect(options.map((o) => o.id)).toEqual(["gpu", "general", "storage"]);
    for (const o of options) {
      expect(o.costM).toBeGreaterThan(0);
      expect(o.height).toBeGreaterThan(0);
    }
  });

  test("서버 카드는 서비스·전원·스위치를 말한다", () => {
    const host = world.links.find((l) => l.kind === "runs_on" && l.from.includes("-iap-vm"))
      ?.to as string;
    const facts = serverFacts(index, catalog, index.entity(host));
    expect(facts.power).toMatch(/PDU/);
    expect(facts.switches).toMatch(/tor-/);
    expect(facts.services).toHaveLength(0);
    const vm = world.links.find((l) => l.kind === "runs_on" && l.from.includes("-iap-vm"))
      ?.from as string;
    expect(serverFacts(index, catalog, index.entity(vm)).services.map((s) => s.name)).toEqual([
      "IAP",
    ]);
  });

  test("단계 합계는 그 단계만 센다: 랙 하나의 서버와 서버룸 전체", () => {
    const room = index.ofKind("room")[0] as { id: string };
    const rack = index
      .ofKind("rack")
      .find((r) => index.childrenOf(r.id).some((c) => c.kind === "server"));
    const one = stepSum(index, catalog, { kind: "room", id: room.id }, rack);
    const all = stepSum(index, catalog, { kind: "room", id: room.id });
    expect(one.label).toBe("이 랙");
    expect(all.label).toBe("이 서버룸");
    expect(all.servers).toBeGreaterThan(one.servers);
    expect(all.services).toBe(1);
  });
});
