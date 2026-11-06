import { FAULT_TOOLS } from "@terrarium/core/scenario";
import {
  DEFAULT_SHAPE,
  IAP_DRAFT,
  planShape,
  type ShapeSpec,
} from "@terrarium/core/sources/worldgen";
import { CHIP_COUNT, LADDER, LAYER_IDS, type Layers } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { planFigures } from "../worldgen-scale";
import { CHEAP_LAYERS, presetLayers, resolveLayers, STEADY_LAYERS } from "./auto-pick";
import { CARDS, chipsOfLayer, LAYER_INFO } from "./ladders";
import { shapeView } from "./shape-view";
import { guessWorkload, workloadView } from "./workload-view";

const specWith = (layers: Partial<Layers>): ShapeSpec => ({
  ...DEFAULT_SHAPE,
  layers: { ...DEFAULT_SHAPE.layers, ...layers },
});

describe("HA 사다리: 선택지와 카드 [REQ-094]", () => {
  test("층은 여덟이고, 카드는 코어의 선택지와 같은 순서로 하나씩 있다", () => {
    expect(LAYER_IDS).toHaveLength(8);
    expect(CARDS).toHaveLength(CHIP_COUNT);
    for (const layer of LAYER_IDS) {
      expect(chipsOfLayer(layer).map((c) => c.card.id)).toEqual(LADDER[layer].map((c) => c.id));
      expect(LAYER_INFO[layer].name).not.toBe("");
    }
  });

  test("점선은 ADR-0107 결정 5의 목록 그대로다", () => {
    const dotted = LAYER_IDS.flatMap((l) => LADDER[l].filter((c) => !c.modeled).map((c) => c.id));
    expect(dotted).toEqual([
      "sto-geo",
      "db-distributed-sql",
      "db-managed-multiaz",
      "app-stateless",
      "app-microservices",
      "app-mesh",
      "app-multiregion",
      "site-dr-warm",
      "site-multi-active",
    ]);
  });

  test("카드마다 그림·문단·잃어도 되는 것·잃으면 안 되는 것·고장·비용이 있고 글 잣대를 지킨다", () => {
    for (const c of CARDS) {
      for (const text of [c.what, c.canLose, c.mustNot, c.faults, c.cost, c.result, c.diagram.alt])
        expect(text.trim().length).toBeGreaterThan(1);
      expect(c.diagram.rows.length).toBeGreaterThan(0);
      if (c.diagram.cut) {
        const [r, i] = c.diagram.cut;
        expect(c.diagram.rows[r]?.n).toBeGreaterThan(i);
      }
      const all = [c.label, c.what, c.canLose, c.mustNot, c.faults, c.cost, c.result].join(" ");
      expect(all).not.toMatch(/장애|타일/);
      expect(c.what).toMatch(/요\.?$|요\. /);
    }
  });
});

describe("알아서와 프리셋 [REQ-094]", () => {
  test("고른 층은 그대로 두고 나머지는 알아서 고르며 한 줄로 이유를 말한다", () => {
    const r = resolveLayers([IAP_DRAFT], { network: "net-three-tier", compute: "cmp-virt-ha" });
    expect(r.layers.network).toBe("net-three-tier");
    expect(r.why.network).toBeUndefined();
    expect(r.why.storage).toMatch(/^알아서 .+로 골랐어요 — /);
    expect(Object.keys(r.why)).toHaveLength(6);
  });

  test("알아서는 다른 층에 맞춘다: 가상화면 공유 저장소, 베어메탈이면 RAID", () => {
    expect(resolveLayers([IAP_DRAFT], { compute: "cmp-virt-ha" }).layers.storage).toBe(
      "sto-shared",
    );
    expect(resolveLayers([IAP_DRAFT], { compute: "cmp-bare" }).layers.storage).toBe(
      "sto-raid-backup",
    );
  });

  test("도메인을 안 고른 사람은 여덟 층 모두 알아서다", () => {
    expect(Object.keys(resolveLayers([IAP_DRAFT], {}).why)).toHaveLength(8);
  });

  test("싸게·보통·멈추지 않게는 여덟 층을 모두 채우고 실제 선택지만 가리킨다", () => {
    for (const row of [CHEAP_LAYERS, presetLayers("middle"), STEADY_LAYERS]) {
      for (const layer of LAYER_IDS)
        expect(LADDER[layer].some((c) => c.id === row?.[layer])).toBe(true);
    }
    expect(presetLayers("auto")).toBeUndefined();
  });
});

describe("이 모양이면 [REQ-094]", () => {
  test("호스트·VM·스위치와 멈추는·느려지는 고장, 살리는 길, 시나리오 수를 코어에서 센다", () => {
    const v = shapeView(DEFAULT_SHAPE);
    expect(v.hosts).toBe(3);
    expect(v.vms).toBe(9);
    expect(v.stops.length).toBeGreaterThan(0);
    expect(v.slows.length).toBeGreaterThan(0);
    expect(v.ways.length).toBeGreaterThan(0);
    expect(v.scenarios).toBeGreaterThan(0);
    for (const p of v.problems) expect(FAULT_TOOLS[p]).toBeDefined();
  });

  test("점선 칸은 고장도 시나리오도 더하지 않는다", () => {
    const dr = shapeView(specWith({ site: "site-dr-warm" }));
    const buildings = shapeView(specWith({ site: "site-two-buildings" }));
    expect(dr.scenarios).toBeLessThanOrEqual(buildings.scenarios);
    expect(dr.dotted.length).toBeGreaterThan(buildings.dotted.length);
    const onlyDb = shapeView(specWith({ database: "db-managed-multiaz" }));
    const ownDb = (v: { problems: readonly string[] }) =>
      v.problems.filter((p) => p.startsWith("db_"));
    expect(ownDb(onlyDb)).toEqual([]);
    expect(ownDb(shapeView(specWith({ database: "db-single" }))).length).toBeGreaterThan(0);
  });

  test("베어메탈 + 핫 스페어는 호스트를 한 대 더하고 VM이 없다", () => {
    const v = shapeView(specWith({ compute: "cmp-bare-spare" }));
    expect(v.vms).toBe(0);
    expect(v.hosts).toBe(10);
  });
});

describe("일감 [REQ-094]", () => {
  test("알아서 서비스 종류에서 일감을 짐작하고 이유를 말한다", () => {
    const g = guessWorkload({ kind: "batch", name: "로그" });
    expect(g.profile.kind).toBe("batch");
    expect(g.why.kind).toMatch(/^알아서 /);
  });

  test("낮과 밤 시나리오 수를 더하면 전체이고, 밤 일감은 밤이 더 많다", () => {
    const view = shapeView(DEFAULT_SHAPE);
    const day = workloadView(
      { ...IAP_DRAFT.workload, pattern: "office" },
      view.problems,
      view.scenarios,
    );
    const night = workloadView(
      { ...IAP_DRAFT.workload, pattern: "night" },
      view.problems,
      view.scenarios,
    );
    expect(day.day + day.night).toBe(view.scenarios);
    expect(night.night).toBeGreaterThan(night.day);
    expect(day.day).toBeGreaterThan(day.night);
  });
});

describe("서버 수와 나머지 숫자 [REQ-094]", () => {
  test("A+B면 PDU가 두 배, N+1이면 냉방기가 하나 더, 리프-스파인이면 스위치가 리프+스파인이다", () => {
    const base = planShape(DEFAULT_SHAPE);
    expect(planShape(specWith({ power: "pwr-single" })).pdus * 2).toBe(base.pdus);
    expect(planShape(specWith({ cooling: "cool-n" })).coolers + 1).toBe(base.coolers);
    expect(base.switches).toBe(base.leaves + base.spines);
    const figures = planFigures(base, DEFAULT_SHAPE.layers).map((f) => f.unit);
    expect(figures.join(" ")).toMatch(
      /랙 .*서버룸.*스위치 · 리프 \d+ \+ 스파인 2.*PDU · A\+B.*냉방기 · N\+1.*kW/,
    );
  });

  test("서버가 많을수록 랙이 늘고 서버 수는 어림으로 맞는다", () => {
    const small = planShape({ ...DEFAULT_SHAPE, servers: 48 });
    const big = planShape({ ...DEFAULT_SHAPE, servers: 4800 });
    expect(big.racks).toBeGreaterThan(small.racks * 10);
    expect(big.computeRacks * 20).toBeGreaterThanOrEqual(4800);
  });
});
