/**
 * How a single place a service runs on is judged (REQ-087, ADR-0091): a storage box that lost disks, filled up or was
 * turned off, a server whose memory failed, and a place that is not a host at all.
 */
import { describe, expect, test } from "vitest";
import { serviceDef } from "../../packages/core/src/world/service";
import { hostVerdict } from "../../packages/core/src/world/service-health";
import { lab } from "./test-support/deep-os-lab";

const defOf = (world: ReturnType<typeof lab>["world"]) =>
  serviceDef(world.index.entity("svc-license"));

describe("a storage box under a service [REQ-087]", () => {
  test("[REQ-087] a box with all its disks and room is fine, and a place that is not a host is never in the way", () => {
    const { world } = lab();
    expect(hostVerdict(world, "stor-b", defOf(world))).toEqual({ id: "stor-b", state: "ok" });
    expect(hostVerdict(world, "rack-a", defOf(world))).toEqual({ id: "rack-a", state: "ok" });
  });

  test("[REQ-087] a box that lost a disk is slow, and says how many", () => {
    const { world, inject, physics } = lab();
    inject("disk_failure", "stor-b", { disks: 2 });
    physics.run(60);
    expect(hostVerdict(world, "stor-b", defOf(world))).toMatchObject({
      state: "slow",
      cause: "storage",
      why: expect.stringContaining("디스크 2개 고장"),
    });
  });

  test("[REQ-087] a box that is nearly full is slow, and says how full", () => {
    const { world } = lab();
    world.stateAs("stor-b", "storage").usedPct = 96.4;
    expect(hostVerdict(world, "stor-b", defOf(world))).toMatchObject({
      state: "slow",
      cause: "storage",
      why: expect.stringContaining("96% 찼어요"),
    });
  });

  test("[REQ-087] a box that was turned off is dead for the service on it", () => {
    const { world } = lab();
    world.stateAs("stor-b", "storage").adminOn = false;
    expect(hostVerdict(world, "stor-b", defOf(world))).toMatchObject({
      state: "dead",
      cause: "off",
      why: expect.stringContaining("꺼져 있어요"),
    });
  });
});

describe("a server whose memory failed [REQ-087]", () => {
  test("[REQ-087] the server is dead for its service, and the cause is the hardware", () => {
    const { world, inject, physics } = lab();
    inject("memory_failure", "srv-a2");
    physics.run(60);
    expect(hostVerdict(world, "srv-a2", defOf(world))).toMatchObject({
      state: "dead",
      cause: "hardware",
      why: expect.stringContaining("메모리 불량으로 멈췄어요"),
    });
  });
});
