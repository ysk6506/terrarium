import { workloadOf } from "@terrarium/core/world";
import { describe, expect, it } from "vitest";
import { DEFAULT_SHAPE, generateShaped, planShape, type ShapeSpec } from "./index";

const withLayers = (layers: Partial<ShapeSpec["layers"]>): ShapeSpec => ({
  ...DEFAULT_SHAPE,
  layers: { ...DEFAULT_SHAPE.layers, ...layers },
});

describe("서비스부터 세계 생성 [REQ-094]", () => {
  it("계획이 센 랙·스위치·PDU가 지은 세계와 맞는다", () => {
    for (const servers of [48, 480]) {
      const spec = { ...DEFAULT_SHAPE, servers };
      const plan = planShape(spec);
      const built = generateShaped(spec);
      expect(built.counts.racks).toBe(plan.racks);
      expect(built.counts.switches).toBe(plan.switches);
      expect(built.counts.services).toBe(1);
      expect(built.counts.serviceVms).toBe(9);
      expect(built.counts.serviceHosts).toBe(3);
    }
  });

  it("서비스의 호스트 셋은 서로 다른 랙에 선다", () => {
    const built = generateShaped(DEFAULT_SHAPE).blueprint;
    const racks = new Set(
      built.links
        .filter((l) => l.kind === "runs_on" && l.from.includes("-iap-vm"))
        .map((l) => built.entities.find((e) => e.id === l.to)?.parentId),
    );
    expect(racks.size).toBe(3);
  });

  it("서비스 정의와 일감이 서비스 개체에 저장된다", () => {
    const svc = generateShaped(DEFAULT_SHAPE).blueprint.entities.find((e) => e.kind === "service");
    expect(svc?.name).toBe("IAP");
    expect(workloadOf(svc as never)?.perMinute).toBe(90);
    expect(JSON.parse(String(svc?.props.harmTiers))).toHaveLength(3);
  });

  it("고른 모양이 세계를 바꾼다: 베어메탈은 VM이 없고 핫 스페어는 호스트를 더한다", () => {
    const bare = generateShaped(withLayers({ compute: "cmp-bare" }));
    expect(bare.counts.serviceVms).toBe(0);
    expect(bare.counts.serviceHosts).toBe(9);
    const spare = planShape(withLayers({ compute: "cmp-bare-spare" }));
    expect(spare.spareHosts).toBe(1);
    expect(planShape(withLayers({ power: "pwr-single" })).pdus).toBeLessThan(
      planShape(DEFAULT_SHAPE).pdus,
    );
    expect(planShape(withLayers({ cooling: "cool-2n" })).coolers).toBeGreaterThan(
      planShape(withLayers({ cooling: "cool-n" })).coolers,
    );
    expect(planShape(withLayers({ site: "site-two-buildings" })).buildings).toBe(2);
  });

  it("점선이던 칸도 이제 자기 모양으로 짓는다: DR 웜은 둘째 사이트와 복제를 더한다 [REQ-106]", () => {
    const a = generateShaped(withLayers({ site: "site-dr-warm" }));
    const b = generateShaped(withLayers({ site: "site-two-buildings" }));
    const count = (r: typeof a, kind: string) =>
      r.blueprint.entities.filter((e) => e.kind === kind).length;
    expect(count(a, "dr_site")).toBe(2);
    expect(count(a, "dr_plan")).toBe(1);
    expect(count(a, "replication_stream")).toBeGreaterThan(0);
    expect(count(b, "dr_site")).toBe(0);
  });
});
