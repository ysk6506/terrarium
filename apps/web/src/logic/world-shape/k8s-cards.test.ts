import { problemName } from "@terrarium/core/scenario";
import { DEFAULT_SHAPE, IAP_DRAFT } from "@terrarium/core/sources/worldgen";
import { chipById, type Layers } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { resolveLayers } from "./auto-pick";
import { cardOf } from "./ladders";
import { shapeView } from "./shape-view";

const MODELED = ["cmp-drs", "cmp-containers", "cmp-multicluster"];

const viewWith = (layers: Partial<Layers>) =>
  shapeView({ ...DEFAULT_SHAPE, layers: { ...DEFAULT_SHAPE.layers, ...layers } });

describe("컴퓨트 칩 셋의 카드는 코어의 고장 목록과 같다 [REQ-096]", () => {
  for (const id of MODELED) {
    test(`${id}: 실선이고 카드의 '생기는 고장'이 멈추는 고장과 느려지는 고장을 이름으로 푼 것이다`, () => {
      const chip = chipById(id);
      expect(chip?.modeled).toBe(true);
      const names = [...(chip?.stops ?? []), ...(chip?.slows ?? [])].map(problemName);
      expect(names.length).toBeGreaterThan(0);
      expect(cardOf(id)?.faults.split(" · ")).toEqual(names);
      expect(cardOf(id)?.result).not.toMatch(/아직 흉내 낼 수 없어요/);
    });
  }
});

describe("IAP 기본 카드는 컨테이너 오케스트레이션이다 [REQ-096]", () => {
  test("컴퓨트 기본이 컨테이너 오케스트레이션이고 '이 모양이면'에 쿠버네티스 고장이 든다", () => {
    expect(DEFAULT_SHAPE.layers.compute).toBe("cmp-containers");
    const v = shapeView(DEFAULT_SHAPE);
    expect(v.problems).toEqual(
      expect.arrayContaining(["k8s_pod_crashloop", "k8s_node_notready", "k8s_etcd_quorum_lost"]),
    );
    expect(v.stops).toContain("파드 CrashLoopBackOff");
    expect(v.ways).toEqual(expect.arrayContaining(["롤아웃 재시작하기"]));
    expect(v.dotted).toEqual([]);
    expect(v.hosts).toBe(3);
    expect(v.vms).toBe(9);
  });

  test("멀티클러스터는 서비스를 멈추게 하는 고장이 없고 호스트가 두 배다", () => {
    const one = viewWith({ compute: "cmp-containers" });
    const two = viewWith({ compute: "cmp-multicluster" });
    expect(chipById("cmp-multicluster")?.stops).toEqual([]);
    expect(two.hosts).toBe(one.hosts * 2);
    expect(two.vms).toBe(one.vms * 2);
  });

  test("카드에 컨트롤 플레인 VM이 있는 서비스는 알아서도 컨테이너를 고른다", () => {
    const r = resolveLayers([IAP_DRAFT], {});
    expect(r.layers.compute).toBe("cmp-containers");
    expect(r.why.compute).toMatch(/직접 만든 쿠버네티스/);
  });

  test("점선으로 남은 컴퓨트 칩은 없다", () => {
    for (const id of ["cmp-bare", "cmp-bare-spare", "cmp-virt-ha", ...MODELED])
      expect(chipById(id)?.modeled, id).toBe(true);
  });
});
