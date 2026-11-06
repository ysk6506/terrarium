import { FAULT_TOOLS, problemName } from "@terrarium/core/scenario";
import { DEFAULT_SHAPE } from "@terrarium/core/sources/worldgen";
import { chipById, type Layers } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { cardOf } from "./ladders";
import { shapeView } from "./shape-view";

const MODELED = ["net-sdn", "net-cloud-native"];

const viewWith = (layers: Partial<Layers>) =>
  shapeView({ ...DEFAULT_SHAPE, layers: { ...DEFAULT_SHAPE.layers, ...layers } });

describe("SDN과 클라우드 네이티브 칩의 카드는 코어의 고장 목록과 같다 [REQ-097]", () => {
  for (const id of MODELED) {
    test(`${id}: 실선이고, 카드의 '생기는 고장'이 멈추는 고장과 느려지는 고장을 이름으로 푼 것이다`, () => {
      const chip = chipById(id);
      expect(chip?.modeled).toBe(true);
      expect(chip?.build.overlay?.controllers).toBe(2);
      const names = [...(chip?.stops ?? []), ...(chip?.slows ?? [])].map(problemName);
      expect(names.length).toBeGreaterThan(0);
      expect(cardOf(id)?.faults.split(" · ")).toEqual(names);
    });
  }

  test("클라우드 네이티브만 CNI·정책·인그레스를 짓는다", () => {
    expect(chipById("net-sdn")?.build.overlay?.cloudNative).toBe(false);
    expect(chipById("net-cloud-native")?.build.overlay?.cloudNative).toBe(true);
    expect(chipById("net-sdn")?.slows).not.toContain("cni_plugin_failure");
    expect(chipById("net-cloud-native")?.slows).toContain("cni_plugin_failure");
  });
});

describe("'이 모양이면'에 오버레이 고장이 들어간다 [REQ-097]", () => {
  test("SDN을 고르면 터널 끊김이 멈추는 고장에, 컨트롤러 다운이 느려지는 고장에 들고 시나리오가 따라온다", () => {
    const v = viewWith({ network: "net-sdn" });
    expect(v.problems).toEqual(
      expect.arrayContaining(["vxlan_tunnel_down", "sdn_controller_down"]),
    );
    expect(v.stops).toContain(problemName("vxlan_tunnel_down"));
    expect(v.scenarios).toBeGreaterThan(viewWith({ network: "net-leaf-spine" }).scenarios);
    expect(v.handover.some((h) => h.team === "네트워크팀")).toBe(true);
  });

  test("클라우드 네이티브를 고르면 인그레스 다운이 멈추는 고장에, 잘못된 정책이 느려지는 고장에 든다", () => {
    const v = viewWith({ network: "net-cloud-native" });
    expect(v.stops).toContain(problemName("ingress_controller_down"));
    expect(v.problems).toContain("network_policy_deny");
    expect(FAULT_TOOLS.network_policy_deny.tools).toEqual(["policy_revert"]);
    expect(FAULT_TOOLS.ingress_controller_down.tools).toEqual(["ingress_restart"]);
  });

  test("리프-스파인에는 오버레이 고장이 없다", () => {
    const v = viewWith({ network: "net-leaf-spine" });
    expect(v.problems).not.toContain("vxlan_tunnel_down");
    expect(v.dotted).toEqual(viewWith({ network: "net-sdn" }).dotted);
  });
});
