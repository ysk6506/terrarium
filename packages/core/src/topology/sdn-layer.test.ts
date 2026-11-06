import { Physics } from "@terrarium/core/physics";
import { describe, expect, test } from "vitest";
import { sampleWorld } from "../world/test-support/sample-world";
import { type SdnLabOptions, sdnLab } from "../world/test-support/sdn-lab";
import { impactOf } from "./impact";
import { layerShape, statusOf } from "./layers";

const lab = (options: SdnLabOptions = {}) => {
  const world = sampleWorld(sdnLab(options));
  const physics = new Physics(world);
  physics.settle();
  physics.run(300);
  return { world, physics };
};

const inject = (world: ReturnType<typeof lab>["world"], type: string, target: string) =>
  world.apply(
    { type: "fault.add", fault: { id: `f-${type}`, type: type as never, target, params: {} } },
    "test",
  );

describe("the overlay stages sit next to the switches in the network layer [REQ-097] [REQ-078]", () => {
  test("services, doors, segments, controllers and VTEPs come before the core, spine and ToR switches", () => {
    const { world } = lab({ cloudNative: true });
    const shape = layerShape(world.index, "network");
    const labels = shape.stages.map((s) => s.label);
    const at = (name: string) => labels.indexOf(name);
    expect(at("서비스")).toBe(0);
    for (const [before, after] of [
      ["인그레스·정책·CNI", "오버레이 세그먼트"],
      ["오버레이 세그먼트", "SDN 컨트롤러"],
      ["SDN 컨트롤러", "VTEP"],
      ["VTEP", "ToR 스위치"],
    ] as const)
      expect(at(before), `${before} < ${after}`).toBeLessThan(at(after));
    expect(shape.kindOf.get("vtep-tor-a")).toBe("vtep");
    expect(shape.kindOf.get("seg-portal")).toBe("overlay_segment");
    expect(shape.kindOf.get("sdn-ctl-1")).toBe("sdn_controller");
    expect(shape.consumers.get("svc-portal")).toEqual(
      expect.arrayContaining(["seg-portal", "ingress-portal"]),
    );
    expect(shape.consumers.get("seg-portal")).toEqual(
      expect.arrayContaining(["vtep-tor-a", "vtep-tor-b"]),
    );
    expect(shape.consumers.get("vtep-tor-a")).toEqual(expect.arrayContaining(["tor-a"]));
    expect(shape.consumers.get("sdn-ctl-1")).toEqual(expect.arrayContaining(["tor-a", "tor-b"]));
  });

  test("a world without an overlay has no such stages", () => {
    const world = sampleWorld(sdnLab());
    const plain = layerShape(world.index, "network").stages.map((s) => s.label);
    expect(plain).toContain("VTEP");
    expect(plain).not.toContain("인그레스·정책·CNI");
  });
});

describe("the impact range runs from the underlay switch through the VTEP and the segment to the service [REQ-097] [REQ-078]", () => {
  test("a switch that loses power puts its VTEP, the segments it carries and the services on them in the range", () => {
    const { world, physics } = lab();
    inject(world, "switch_failure", "tor-a");
    physics.run(60);
    const status = statusOf(world, impactOf(world));
    expect(status.stateOf("tor-a")).toBe("fault");
    for (const id of ["vtep-tor-a", "seg-license", "svc-license", "seg-portal", "svc-portal"])
      expect(status.stateOf(id), id).not.toBe("ok");
  });

  test("a cut tunnel puts the VTEP and the segment in the range and leaves the other leaf alone", () => {
    const { world, physics } = lab();
    inject(world, "vxlan_tunnel_down", "vtep-tor-b");
    physics.run(60);
    const status = statusOf(world, impactOf(world));
    expect(status.stateOf("vtep-tor-b")).toBe("fault");
    expect(status.stateOf("seg-portal")).not.toBe("ok");
    expect(status.stateOf("svc-portal")).not.toBe("ok");
    expect(status.stateOf("seg-license")).toBe("ok");
    expect(status.stateOf("svc-license")).toBe("ok");
  });

  test("a closed ingress puts the door and the service behind it in the range", () => {
    const { world, physics } = lab({ cloudNative: true });
    inject(world, "ingress_controller_down", "ingress-portal");
    physics.run(60);
    const status = statusOf(world, impactOf(world));
    expect(status.stateOf("ingress-portal")).toBe("fault");
    expect(status.stateOf("svc-portal")).not.toBe("ok");
    expect(status.stateOf("svc-license")).toBe("ok");
  });
});
