import { Physics } from "@terrarium/core/physics";
import { describe, expect, test } from "vitest";
import { dbLab } from "../world/test-support/db-lab";
import { sampleWorld } from "../world/test-support/sample-world";
import { impactOf } from "./impact";
import { layerShape, statusOf } from "./layers";

const lab = (options: Parameters<typeof dbLab>[0]) => {
  const world = sampleWorld(dbLab(options));
  const physics = new Physics(world);
  physics.settle();
  physics.run(300);
  return { world, physics };
};

describe("the database and storage stages sit next to the services in the network layer [REQ-095] [REQ-078]", () => {
  test("services, clusters, instances and the pool with its controllers come before the switches", () => {
    const { world } = lab({ shape: "replicated", storage: "multipath" });
    const shape = layerShape(world.index, "network");
    const labels = shape.stages.map((s) => s.label);
    expect(labels.slice(0, 4)).toEqual([
      "서비스",
      "데이터베이스",
      "DB 인스턴스",
      "스토리지 풀·컨트롤러",
    ]);
    expect(shape.kindOf.get("db-main")).toBe("db_cluster");
    expect(shape.kindOf.get("pool-db")).toBe("storage_pool");
    expect(shape.consumers.get("svc-web")).toEqual(expect.arrayContaining(["db-main"]));
    expect(shape.consumers.get("db-main")).toEqual(expect.arrayContaining(["db-1", "db-2"]));
    expect(shape.consumers.get("db-1")).toEqual(expect.arrayContaining(["pool-db", "vm-db-1"]));
  });

  test("a world without a database has no such stages", () => {
    const { world } = lab({ shape: "single" });
    expect(layerShape(world.index, "network").stages.map((s) => s.label)).not.toContain(
      "스토리지 풀·컨트롤러",
    );
  });
});

describe("the impact range runs through the database to the services [REQ-095] [REQ-078]", () => {
  test("a primary that is down puts its cluster and the services that lean on it in the range", () => {
    const { world, physics } = lab({ shape: "replicated" });
    world.apply(
      {
        type: "fault.add",
        fault: { id: "f1", type: "db_primary_down", target: "db-1", params: {} },
      },
      "test",
    );
    physics.run(60);
    const impact = impactOf(world);
    const status = statusOf(world, impact);
    expect(status.stateOf("db-1")).toBe("fault");
    for (const id of ["db-main", "svc-web", "svc-license"])
      expect(status.stateOf(id), id).not.toBe("ok");
    expect(status.stateOf("db-2")).toBe("ok");
    expect(impact.services.down + impact.services.degraded).toBe(2);
  });

  test("a dead controller reaches the pool, the instances that keep data in it and then the services", () => {
    const { world, physics } = lab({ shape: "shared_aa", storage: "dual" });
    for (const id of ["ctl-a", "ctl-b"])
      world.apply(
        {
          type: "fault.add",
          fault: { id: `f-${id}`, type: "storage_controller_failure", target: id, params: {} },
        },
        "test",
      );
    physics.run(60);
    const status = statusOf(world, impactOf(world));
    for (const id of ["pool-db", "db-1", "db-2", "db-3", "db-main", "svc-web", "svc-license"])
      expect(status.stateOf(id), id).not.toBe("ok");
    expect(status.stateOf("ctl-a")).toBe("fault");
  });

  test("one of two controllers makes the pool slow but leaves the instances alone", () => {
    const { world, physics } = lab({ shape: "shared_aa", storage: "multipath" });
    world.apply(
      {
        type: "fault.add",
        fault: { id: "f1", type: "storage_controller_failure", target: "ctl-a", params: {} },
      },
      "test",
    );
    physics.run(60);
    const status = statusOf(world, impactOf(world));
    expect(status.stateOf("ctl-a")).toBe("fault");
    expect(status.stateOf("pool-db")).toBe("alarm");
    expect(status.stateOf("db-1")).toBe("ok");
  });
});
