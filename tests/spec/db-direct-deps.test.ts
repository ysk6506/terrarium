/**
 * A service can lean on a storage pool or on one database instance directly, not only on a cluster (REQ-095): the pool
 * or the instance's cluster then decides what the service is, in the words of the pool or the cluster.
 */
import { Catalog } from "@terrarium/core/catalog";
import { Physics } from "@terrarium/core/physics";
import { type FaultType, World } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { dbLab } from "../../packages/core/src/world/test-support/db-lab";

const MINUTE = 60;

function lab(leansOn: string, storage: "dual" | "distributed") {
  const bp = dbLab({ shape: "replicated", storage });
  const links = [
    ...bp.links.filter((l) => l.id !== "web-db"),
    { id: "web-direct", kind: "depends_on" as const, from: "svc-web", to: leansOn, props: {} },
  ];
  const world = World.fromBlueprint({ ...bp, links }, new Catalog());
  const physics = new Physics(world);
  physics.settle();
  physics.run(5 * MINUTE);
  const inject = (type: FaultType, target: string, params: Record<string, number> = {}) =>
    world.apply(
      { type: "fault.add", fault: { id: `f-${type}-${target}`, type, target, params } },
      "scenario",
    );
  const status = () => world.stateAs("svc-web", "service");
  return { physics, inject, status };
}

describe("a service that leans on a storage pool or an instance directly [REQ-095]", () => {
  test("it is healthy while the pool is, and stopped by the pool's own stop with the pool's words", () => {
    const { physics, inject, status } = lab("pool-db", "dual");
    expect(status().status).toBe("healthy");
    inject("storage_controller_failure", "ctl-a");
    inject("storage_controller_failure", "ctl-b");
    physics.run(MINUTE);
    expect(status().status).toBe("down");
    expect(status().reasons.join(" ")).toContain("풀-DB");
  });

  test("a distributed pool that loses a node is slow for the service that leans on it, with the pool's words", () => {
    const { physics, inject, status } = lab("pool-db", "distributed");
    inject("storage_node_lost", "stor-c1");
    physics.run(MINUTE);
    expect(["degraded", "down"]).toContain(status().status);
    expect(status().reasons.join(" ")).toContain("풀-DB");
  });

  test("leaning on one instance is leaning on the cluster it belongs to", () => {
    const { physics, inject, status } = lab("db-2", "dual");
    expect(status().status).toBe("healthy");
    inject("db_primary_down", "db-1");
    physics.run(MINUTE);
    expect(status().status).not.toBe("healthy");
  });
});
