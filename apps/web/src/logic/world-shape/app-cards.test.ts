import { FAULT_TOOLS, problemName } from "@terrarium/core/scenario";
import { DEFAULT_SHAPE } from "@terrarium/core/sources/worldgen";
import { chipById, LADDER, type Layers } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { cardOf } from "./ladders";
import { shapeView } from "./shape-view";

const MODELED = ["app-stateless", "app-microservices", "app-mesh", "app-multiregion"];

const viewWith = (layers: Partial<Layers>) =>
  shapeView({ ...DEFAULT_SHAPE, layers: { ...DEFAULT_SHAPE.layers, ...layers } });

describe("애플리케이션 칩 네 개는 실선이고 카드는 코어의 고장 목록과 같다 [REQ-100]", () => {
  for (const id of MODELED) {
    test(`${id}: 실선이고, 카드의 '생기는 고장'이 멈추는 고장과 느려지는 고장을 이름으로 푼 것이다`, () => {
      const chip = chipById(id);
      expect(chip?.modeled).toBe(true);
      expect(chip?.build.app).toBeDefined();
      const names = [...(chip?.stops ?? []), ...(chip?.slows ?? [])].map(problemName);
      expect(names.length).toBeGreaterThan(0);
      expect(cardOf(id)?.faults.split(" · ")).toEqual(names);
    });
  }

  test("점선은 하나도 남지 않는다 [REQ-106]", () => {
    const dotted = (["storage", "database", "app", "power", "network", "site"] as const).flatMap(
      (l) => (LADDER[l] ?? []).filter((c) => !c.modeled).map((c) => c.id),
    );
    expect(dotted).toEqual([]);
  });

  test("칩을 올릴수록 짓는 것이 늘어난다: 세션 저장소, 브레이커, 메시, 리전", () => {
    expect(chipById("app-stateless")?.build.app).toMatchObject({
      sessionStore: true,
      breakers: false,
    });
    expect(chipById("app-microservices")?.build.app).toMatchObject({ breakers: true, mesh: false });
    expect(chipById("app-mesh")?.build.app).toMatchObject({ mesh: true, regions: 1 });
    expect(chipById("app-multiregion")?.build.app).toMatchObject({ regions: 2 });
  });
});

describe("'이 모양이면'에 애플리케이션 고장이 들어간다 [REQ-100]", () => {
  test("서비스 메시를 고르면 재시도 폭주가 느려지는 고장에 들고 시나리오가 따라온다", () => {
    const v = viewWith({ app: "app-mesh" });
    expect(v.problems).toEqual(
      expect.arrayContaining(["retry_storm", "sidecar_crash", "mesh_control_down"]),
    );
    expect(v.scenarios).toBeGreaterThan(viewWith({ app: "app-lb-sticky" }).scenarios);
    expect(FAULT_TOOLS.retry_storm.tools).toEqual(["mesh_rollback"]);
  });

  test("멀티 리전을 고르면 리전 다운이 들고, 로드 밸런서만 있으면 들지 않는다", () => {
    expect(viewWith({ app: "app-multiregion" }).problems).toContain("region_down");
    expect(viewWith({ app: "app-lb-sticky" }).problems).not.toContain("region_down");
    expect(FAULT_TOOLS.region_down.tools).toContain("region_failover");
  });
});
