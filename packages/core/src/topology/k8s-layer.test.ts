import { Physics } from "@terrarium/core/physics";
import { describe, expect, test } from "vitest";
import { k8sLab } from "../world/test-support/k8s-lab";
import { sampleWorld } from "../world/test-support/sample-world";
import { impactOf } from "./impact";
import { layerShape, statusOf } from "./layers";

const lab = () => {
  const world = sampleWorld(k8sLab());
  const physics = new Physics(world);
  physics.settle();
  physics.run(300);
  return { world, physics };
};

describe("the container stages sit next to the services in the network layer [REQ-096] [REQ-078]", () => {
  test("services, workloads with their pods, the cluster and its nodes come before the switches", () => {
    const { world } = lab();
    const shape = layerShape(world.index, "network");
    expect(shape.stages.map((s) => s.label).slice(0, 4)).toEqual([
      "서비스",
      "워크로드·파드",
      "쿠버네티스 클러스터",
      "쿠버네티스 노드",
    ]);
    expect(shape.kindOf.get("k8s-main")).toBe("k8s_cluster");
    expect(shape.consumers.get("svc-portal")).toEqual(expect.arrayContaining(["web"]));
    expect(shape.consumers.get("web")).toEqual(expect.arrayContaining(["k8s-main"]));
    expect(shape.consumers.get("k8s-main")).toEqual(
      expect.arrayContaining(["main-w1", "main-cp1"]),
    );
    expect(shape.consumers.get("main-w1")).toEqual(expect.arrayContaining(["vm-main-w1"]));
  });
});

describe("the impact range runs host → VM → node → pod → workload → service [REQ-096] [REQ-078]", () => {
  test("a VM that is off takes its node, the workloads with pods on it and the service into the range", () => {
    const { world, physics } = lab();
    world.apply({ type: "power.set", target: "vm-main-w3", on: false }, "test");
    physics.run(90);
    const status = statusOf(world, impactOf(world));
    for (const id of ["main-w3", "web", "svc-portal"])
      expect(status.stateOf(id), id).not.toBe("ok");
    expect(status.stateOf("main-w1")).toBe("ok");
  });

  test("a crashing workload is in the range with the service, and its nodes are not", () => {
    const { world, physics } = lab();
    world.apply(
      {
        type: "fault.add",
        fault: { id: "f", type: "k8s_pod_crashloop", target: "web", params: {} },
      },
      "test",
    );
    physics.run(120);
    const status = statusOf(world, impactOf(world));
    expect(status.stateOf("web")).not.toBe("ok");
    expect(status.stateOf("svc-portal")).not.toBe("ok");
    expect(status.stateOf("main-w1")).toBe("ok");
  });
});
