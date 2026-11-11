/**
 * What a service says when the database under it is hurt in a way the shape of the cluster decides (REQ-095): a shared-disk
 * cluster whose disk cannot be written or that lost a node, a cluster on a pool of nodes that lost one, and a single
 * instance that stopped.
 */
import { Catalog } from "@terrarium/core/catalog";
import { Physics } from "@terrarium/core/physics";
import { serviceHealth, World } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { type DbLabOptions, dbLab } from "../../packages/core/src/world/test-support/db-lab";

function hurt(options: DbLabOptions, type: string, target: string) {
  const world = World.fromBlueprint(dbLab(options), new Catalog());
  const physics = new Physics(world);
  physics.settle();
  physics.run(300);
  world.apply(
    { type: "fault.add", fault: { id: "f", type, target, params: {} } } as never,
    "scenario",
  );
  physics.run(120);
  return serviceHealth(world, "svc-license");
}

describe("a database hurt in the way its shape decides [REQ-095]", () => {
  test("[REQ-095] a shared-disk cluster whose host cannot write is slow, and says the file system is read-only", () => {
    const health = hurt({ shape: "shared_aa" }, "fs_readonly", "vm-db-1");
    expect(health.status).toBe("degraded");
    expect(health.reasons).toEqual(["DB 클러스터: 파일시스템이 읽기 전용이라 쓸 수 없어요"]);
  });

  test("[REQ-095] a shared-disk cluster that lost a node carries on with the rest, and says how many are left", () => {
    const health = hurt({ shape: "shared_aa" }, "db_primary_down", "db-1");
    expect(health.status).toBe("degraded");
    expect(health.reasons).toEqual(["DB 클러스터: 노드 3개 중 2개로 버티고 있어요"]);
  });

  test("[REQ-095] a cluster on a pool of nodes that lost one is slow, and says how far the rebuild is", () => {
    const health = hurt(
      { shape: "replicated", storage: "distributed" },
      "storage_node_lost",
      "stor-b",
    );
    expect(health.status).toBe("degraded");
    expect(health.reasons[0]).toMatch(/^DB 클러스터: 복제본 2\/3개 — 다시 만드는 중 \d+%$/);
  });

  test("[REQ-095] a single instance that stopped takes its service down, and nothing can take over", () => {
    const health = hurt({ shape: "single" }, "db_primary_down", "db-1");
    expect(health.status).toBe("down");
    expect(health.reasons).toEqual(["DB 클러스터: 프라이머리가 멈췄고 이어받을 인스턴스가 없어요"]);
  });

  test("[REQ-095] a controller that failed under the pool the cluster lives on stops the cluster", () => {
    const health = hurt(
      { shape: "replicated", storage: "dual" },
      "storage_controller_failure",
      "ctl-a",
    );
    expect(health.status).toBe("down");
    expect(health.reasons).toEqual(["DB 클러스터: 프라이머리가 멈췄고 이어받을 인스턴스가 없어요"]);
  });
});
