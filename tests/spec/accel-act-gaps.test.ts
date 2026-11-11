/**
 * What the world refuses to do to the GPU, power and cooling layers, and why (REQ-107): a command that makes no sense is
 * turned back before it is recorded, with the reason in words, whoever sends it. The tools check some of this first;
 * these go to the world itself.
 */
import { Catalog } from "@terrarium/core/catalog";
import { Physics } from "@terrarium/core/physics";
import { type Blueprint, type FaultType, World } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { accelLab, powerLab } from "./test-support/ladder-labs";

function boot(bp: Blueprint) {
  const world = World.fromBlueprint(bp, new Catalog());
  const physics = new Physics(world);
  physics.settle();
  physics.run(120);
  const inject = (type: FaultType, target: string, params: Record<string, number> = {}) =>
    world.apply(
      { type: "fault.add", fault: { id: `t-${type}-${target}`, type, target, params } },
      "scenario",
    );
  return { world, physics, inject };
}

const schedulerId = (world: World): string => world.index.ofKind("job_scheduler")[0]?.id as string;

describe("draining a server from the scheduler [REQ-107]", () => {
  test("[REQ-107] only a GPU server can be drained, once, and only a drained one can be put back", () => {
    const { world } = boot(accelLab("gpu-training-cluster"));
    const gpuServers = new Set(world.index.ofKind("gpu").map((g) => String(g.props.server)));
    const plain = world.index.ofKind("server").find((s) => !gpuServers.has(s.id))?.id as string;
    const gpuServer = [...gpuServers][0] as string;
    expect(() => world.apply({ type: "node.drain", target: plain, on: true }, "operator")).toThrow(
      `'${plain}'는 GPU 서버가 아니에요`,
    );
    expect(() =>
      world.apply({ type: "node.drain", target: gpuServer, on: false }, "operator"),
    ).toThrow(`'${gpuServer}'는 빠져 있지 않아요`);
    world.apply({ type: "node.drain", target: gpuServer, on: true }, "operator");
    expect(() =>
      world.apply({ type: "node.drain", target: gpuServer, on: true }, "operator"),
    ).toThrow(`'${gpuServer}'는 이미 스케줄에서 빠져 있어요`);
    world.apply({ type: "node.drain", target: gpuServer, on: false }, "operator");
    expect(world.stateAs(schedulerId(world), "job_scheduler").drained).toEqual([]);
  });
});

describe("a serving pool and a substation refuse numbers that cannot be [REQ-107]", () => {
  test("[REQ-107] a pool is scaled to a whole number of replicas between one and its capacity", () => {
    const { world } = boot(accelLab("gpu-serving-pool"));
    const pool = world.index.ofKind("inference_pool")[0]?.id as string;
    for (const replicas of [0, -1, 2.5, 10_000]) {
      expect(() => world.apply({ type: "pool.scale", target: pool, replicas }, "operator")).toThrow(
        /복제본은 1~\d+개 사이로 정해요/,
      );
    }
    expect(() =>
      world.apply({ type: "pool.scale", target: pool, replicas: 1 }, "operator"),
    ).not.toThrow();
  });

  test("[REQ-107] the other feed is taken only when it has voltage, and the one in use is not taken again", () => {
    const { world, inject, physics } = boot(powerLab("pwr-substation"));
    const sub = world.index.ofKind("substation")[0]?.id as string;
    const active = world.stateAs(sub, "substation").activeFeed;
    const other = (active === 1 ? 2 : 1) as 1 | 2;
    expect(() =>
      world.apply({ type: "feed.transfer", target: sub, feed: active }, "operator"),
    ).toThrow(`이미 수전 ${active}번 줄에서 받고 있어요`);
    inject("utility_feed_loss", sub, { feed: other });
    physics.run(60);
    expect(() =>
      world.apply({ type: "feed.transfer", target: sub, feed: other }, "operator"),
    ).toThrow(`수전 ${other}번 줄은 전압이 없어요`);
  });
});
