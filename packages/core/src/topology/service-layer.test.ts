import { Physics } from "@terrarium/core/physics";
import { describe, expect, test } from "vitest";
import { sampleWorld } from "../world/test-support/sample-world";
import { serviceLab } from "../world/test-support/service-lab";
import { impactOf } from "./impact";
import { layerShape } from "./layers";
import { impactServices } from "./words";

const lab = () => {
  const world = sampleWorld(serviceLab());
  new Physics(world).settle();
  return { world, physics: new Physics(world) };
};

describe("services are the top of the network layer and the first line of the impact box [REQ-086] [REQ-078]", () => {
  test("the network layer starts with a stage of services that lean on what they run on", () => {
    const { world } = lab();
    const shape = layerShape(world.index, "network");
    expect(shape.stages[0]?.label).toBe("서비스");
    expect([...(shape.members[0] ?? [])].sort()).toEqual(["svc-license", "svc-queue", "svc-web"]);
    expect(shape.kindOf.get("svc-web")).toBe("service");
    expect(shape.consumers.get("svc-web")).toEqual(expect.arrayContaining(["vm-web"]));
  });

  test("a healthy world says nothing about services; a stopped server says how many stopped and what waits", () => {
    const { world, physics } = lab();
    expect(impactServices(impactOf(world))).toBe("");
    world.apply({ type: "power.set", target: "srv-a2", on: false }, "test");
    physics.run(3600);
    const line = impactServices(impactOf(world));
    expect(line).toMatch(/^서비스 \d+개 멈춤/);
    expect(line).toMatch(/설계 검증 큐 [\d,]+건 대기/);
  });
});
