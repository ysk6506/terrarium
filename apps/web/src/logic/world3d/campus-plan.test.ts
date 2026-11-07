import { Catalog } from "@terrarium/core/catalog";
import { DEFAULT_CAMPUS, generateCampus } from "@terrarium/core/sources/worldgen";
import { BlueprintIndex } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { APRON_M, baysFor, campusPlan, ROAD_W_M, standable, TREE_GAP_M } from "./campus-plan";
import type { CampusPlan, PlanBuilding, PlanSite } from "./campus-plan-types";
import { type Bounds, boundsOfBox, insidePolygon, overlapBounds, type Pt } from "./plan";
import { siteScene } from "./site";

const catalog = new Catalog();
const world = (seed: number, buildings: number, pods = 6) =>
  new BlueprintIndex(
    generateCampus(
      {
        ...DEFAULT_CAMPUS,
        site: "giheung",
        seed,
        buildings,
        floors: pods === 5 ? 1 : 2,
        hallsPerFloor: pods === 5 ? 1 : 2,
        podsPerHall: pods,
        detail: 0.3,
      },
      catalog,
    ).blueprint,
  );
const scene = siteScene(world(7, 3), catalog);
if (!scene) throw new Error("no site");

const siteOf = (s: NonNullable<typeof scene>): PlanSite => ({
  outline: s.outline,
  gate: s.gate,
  obstacles: [],
  avoid: s.parcels.filter((p) => !p.owned).map((p) => p.area),
  yards: s.yards.map((y) => ({ id: y.id, area: y.area })),
});
const buildingsOf = (s: NonNullable<typeof scene>): PlanBuilding[] =>
  s.buildings.map((b) => ({ id: b.id, bounds: boundsOfBox(b), servers: b.servers }));

const site = siteOf(scene);
const buildings = buildingsOf(scene);
const plan: CampusPlan = campusPlan(site, buildings, 5);
const inside = (p: Pt, b: Bounds, m = 0) =>
  p.x > b.x0 - m && p.x < b.x1 + m && p.z > b.z0 - m && p.z < b.z1 + m;

describe("부지 배치: 도로 → 주차장 → 차 → 나무 [REQ-105]", () => {
  test("도로는 폭 6 m이고 건물 발자국을 지나지 않으며 건물마다 진입로가 있다", () => {
    expect(plan.roads.length).toBeGreaterThan(0);
    expect(ROAD_W_M).toBe(6);
    for (const r of plan.roads)
      for (const b of buildings) expect(overlapBounds(r.area, b.bounds)).toBe(false);
    for (const b of buildings) {
      const e = plan.entrances.find((x) => x.id === b.id);
      expect(e?.path.length).toBeGreaterThan(0);
    }
    expect(plan.roadPlan.routes.some((r) => r.id.startsWith("spine"))).toBe(true);
  });

  test("주차장은 건물마다 하나, 칸은 서버 40대에 하나(6~60), 칸 2.5×5 m", () => {
    expect(baysFor(0)).toBe(6);
    expect(baysFor(400)).toBe(10);
    expect(baysFor(100000)).toBe(60);
    expect(plan.parking).toHaveLength(buildings.length);
    for (const lot of plan.parking) {
      expect(lot.bays.length).toBeGreaterThanOrEqual(6);
      expect(lot.bays.length).toBeLessThanOrEqual(lot.wanted);
      for (const bay of lot.bays) {
        expect(Math.min(bay.w, bay.d)).toBe(2.5);
        expect(Math.max(bay.w, bay.d)).toBe(5);
      }
      for (const r of plan.roads) expect(overlapBounds(lot.area, r.area)).toBe(false);
      // 길에 맞닿아 있다
      const touching = plan.roads.some(
        (r) =>
          overlapBounds({ ...lot.area, x0: lot.area.x0 - 0.01, x1: lot.area.x1 + 0.01 }, r.area) ||
          overlapBounds({ ...lot.area, z0: lot.area.z0 - 0.01, z1: lot.area.z1 + 0.01 }, r.area),
      );
      expect(touching).toBe(true);
    }
  });

  test("차는 칸 안에만 서고 칸의 40~70 %를 채우며 서로 겹치지 않는다", () => {
    expect(plan.cars.length).toBeGreaterThan(0);
    for (const lot of plan.parking) {
      const mine = plan.cars.filter((c) => c.parking === lot.id);
      expect(mine.length / lot.bays.length).toBeGreaterThanOrEqual(0.39);
      expect(mine.length / lot.bays.length).toBeLessThanOrEqual(0.71);
      const used = new Set(mine.map((c) => c.bay));
      expect(used.size).toBe(mine.length);
    }
    for (const c of plan.cars) {
      const lot = plan.parking.find((l) => l.id === c.parking);
      const bay = lot?.bays[c.bay];
      expect(bay && Math.abs(c.x - bay.x) < 1e-9 && Math.abs(c.z - bay.z) < 1e-9).toBe(true);
      for (const b of buildings) expect(inside(c, b.bounds)).toBe(false);
    }
  });

  test("나무끼리 3 m 이상 떨어지고, 건물·도로·주차장에서 3 m 안에 없다", () => {
    expect(plan.trees.length).toBeGreaterThan(50);
    for (let i = 0; i < plan.trees.length; i++) {
      const t = plan.trees[i] as Pt;
      for (let j = i + 1; j < plan.trees.length; j++) {
        const u = plan.trees[j] as Pt;
        if (Math.abs(t.x - u.x) < TREE_GAP_M)
          expect(Math.hypot(t.x - u.x, t.z - u.z)).toBeGreaterThanOrEqual(TREE_GAP_M);
      }
    }
    const keep = [
      ...buildings.map((b) => b.bounds),
      ...plan.roads.map((r) => r.area),
      ...plan.parking.map((p) => p.area),
    ];
    for (const t of plan.trees) {
      expect(insidePolygon(t, scene.outline)).toBe(true);
      for (const b of keep) expect(inside(t, b, 3 - 1e-6)).toBe(false);
    }
  });

  test("차와 나무가 겹치지 않는다", () => {
    for (const c of plan.cars)
      for (const t of plan.trees) expect(Math.hypot(c.x - t.x, c.z - t.z)).toBeGreaterThan(3);
  });

  test("발자국 안과 2 m 둘레(진입로 빼고)는 비어 있다", () => {
    for (const b of buildings) {
      const apron = {
        x0: b.bounds.x0 - APRON_M,
        z0: b.bounds.z0 - APRON_M,
        x1: b.bounds.x1 + APRON_M,
        z1: b.bounds.z1 + APRON_M,
      };
      for (const t of plan.trees) expect(inside(t, apron)).toBe(false);
      for (const c of plan.cars) expect(inside(c, apron)).toBe(false);
      for (const lot of plan.parking) expect(overlapBounds(lot.area, apron)).toBe(false);
    }
    const zones = plan.clearZones.map((z) => z.kind);
    expect(zones).toContain("footprint");
    expect(zones).toContain("apron");
    expect(zones).toContain("entrance");
  });

  test("울타리 줄·길가 줄·작은 숲이 모두 있다", () => {
    const rows = new Set(plan.trees.map((t) => t.row));
    expect(rows).toContain("fence");
    expect(rows).toContain("road");
  });

  test("사람과 동물이 설 수 있는 곳은 길·주차장·건물 밖이다", () => {
    for (const r of plan.roads) expect(standable(plan, centre(r.area))).toBe(false);
    for (const l of plan.parking) expect(standable(plan, centre(l.area))).toBe(false);
    for (const b of buildings) expect(standable(plan, centre(b.bounds))).toBe(false);
  });

  test("같은 씨앗이면 똑같고, 다른 씨앗이면 차 채움이 달라진다", () => {
    expect(campusPlan(site, buildings, 5)).toEqual(plan);
    const other = campusPlan(site, buildings, 6);
    expect(other.cars.map((c) => c.bay)).not.toEqual(plan.cars.map((c) => c.bay));
  });

  test("랙 48개 안팎 캠퍼스를 50 ms 안에 배치하고, 랙 천 개가 넘는 큰 캠퍼스도 100 ms 안이다", () => {
    const timed = (scene: ReturnType<typeof siteScene>) => {
      if (!scene) throw new Error("no site");
      const s = siteOf(scene);
      const b = buildingsOf(scene);
      campusPlan(s, b, 5);
      const t0 = performance.now();
      const p = campusPlan(s, b, 5);
      expect(p.parking.length).toBeGreaterThan(0);
      return performance.now() - t0;
    };
    const small = siteScene(world(1, 1, 5), catalog);
    const racks = small?.buildings.reduce((n, b) => n + b.racks, 0) ?? 0;
    expect(racks).toBeGreaterThanOrEqual(40);
    expect(racks).toBeLessThanOrEqual(70);
    expect(timed(small)).toBeLessThan(50);
    expect(timed(siteScene(world(3, 4), catalog))).toBeLessThan(100);
  });

  test("장면은 이 배치를 그대로 쓴다", () => {
    expect(scene.trees).toBe(scene.plan.trees);
    expect(scene.roads.rects.length).toBe(scene.plan.roads.length);
    expect(scene.lots.flatMap((l) => l.cars).length).toBe(scene.plan.cars.length);
  });
});

function centre(b: Bounds): Pt {
  return { x: (b.x0 + b.x1) / 2, z: (b.z0 + b.z1) / 2 };
}
