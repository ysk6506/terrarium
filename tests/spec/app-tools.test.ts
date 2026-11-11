/**
 * The application-layer tools of an agent (REQ-100): the balancer, the circuit breaker, the mesh and the regions, what
 * each reads and does, and what it says when the world has none of the thing or the name is wrong.
 */
import { Catalog } from "@terrarium/core/catalog";
import type { Facades } from "@terrarium/core/facades";
import { Physics } from "@terrarium/core/physics";
import { TOOL_NAMES, Toolbox } from "@terrarium/core/tools";
import { type FaultType, World } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { type AppLevel, appLab } from "../../packages/core/src/world/test-support/app-lab";

function lab(level: AppLevel) {
  const world = World.fromBlueprint(appLab({ level }), new Catalog());
  const physics = new Physics(world);
  physics.settle();
  physics.run(120);
  const box = new Toolbox(TOOL_NAMES);
  const raw = (tool: string, args: Record<string, unknown> = {}) =>
    box.call(tool, args, { world, facades: {} as Facades });
  const data = (tool: string, args: Record<string, unknown> = {}) => {
    const r = raw(tool, args);
    expect(r.error, `${tool}: ${r.error}`).toBeUndefined();
    return r.data as any;
  };
  const inject = (type: FaultType, target: string, params: Record<string, number> = {}) =>
    world.apply(
      { type: "fault.add", fault: { id: `f-${type}-${target}`, type, target, params } },
      "scenario",
    );
  return { world, physics, raw, data, inject };
}

describe("lb_status, lb_drain and lb_enable manage the backends behind a balancer [REQ-100]", () => {
  test("every balancer is listed, one can be asked for by its service, and a name that is no service is refused", () => {
    const { data, raw } = lab("lb");
    expect(data("lb_status").balancers).toHaveLength(1);
    expect(data("lb_status", { service: "svc-portal" }).balancers[0].id).toBe("lb-portal");
    expect(raw("lb_status", { service: "srv-a1" }).error).toContain("서비스가 아니에요");
    expect(raw("lb_status", { service: "svc-license" }).error).toContain(
      "앞에는 로드 밸런서가 없어요",
    );
  });

  test("a drained backend is told so, and enabling it says it needs two passing checks", () => {
    const { data, world, physics } = lab("lb");
    expect(data("lb_drain", { backend: "app-portal-1" })).toMatchObject({
      backend: "app-portal-1",
      drained: true,
    });
    physics.run(30);
    expect(world.stateAs("app-portal-1", "app_instance").inRotation).toBe(false);
    const on = data("lb_enable", { backend: "app-portal-1" });
    expect(on).toMatchObject({ drained: false });
    expect(on.note).toContain("2번 통과하면");
    physics.run(120);
    expect(world.stateAs("app-portal-1", "app_instance").inRotation).toBe(true);
  });
});

describe("breaker_status and breaker_reset read and close the breaker on a call [REQ-100]", () => {
  test("the breaker shows its limits and its callers, and can be filtered by either end", () => {
    const { data } = lab("microservices");
    const all = data("breaker_status").breakers;
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({
      caller: "svc-portal",
      callee: "svc-license",
      mode: "closed",
      trips: 0,
    });
    expect(all[0].opensAfterFailures).toBeGreaterThan(0);
    expect(all[0].resetSeconds).toBeGreaterThan(0);
    expect(data("breaker_status", { service: "svc-license" }).breakers).toHaveLength(1);
    expect(data("breaker_status", { service: "svc-nothing" }).breakers).toEqual([]);
  });

  test("a stuck-open breaker shows when it will try half-open, and a reset closes it by breaker id or by link", () => {
    const { data, raw, inject, physics, world } = lab("microservices");
    const breaker = [...world.index.ofKind("circuit_breaker")][0]?.id as string;
    inject("circuit_breaker_stuck_open", breaker);
    physics.run(60);
    const row = data("breaker_status").breakers[0];
    expect(row.mode).toBe("open");
    const closed = data("breaker_reset", { link: breaker });
    expect(closed).toMatchObject({ breaker });
    expect(closed.note).toContain("닫았어요");
    expect(raw("breaker_reset", { link: "nothing" }).error).toContain("서킷 브레이커가 없어요");
  });

  test("a world without breakers says so", () => {
    expect(lab("lb").raw("breaker_status").error).toContain("서킷 브레이커가 없어요");
    expect(lab("lb").raw("mesh_status").error).toContain("서비스 메시가 없어요");
    expect(lab("lb").raw("mesh_rollback").error).toContain("서비스 메시가 없어요");
  });
});

describe("mesh_status and mesh_rollback show the control plane and its sidecars [REQ-100]", () => {
  test("the control plane and each sidecar are listed, and one instance can be asked for", () => {
    const { data } = lab("mesh");
    const s = data("mesh_status");
    expect(s.controls).toHaveLength(1);
    expect(s.controls[0]).toMatchObject({ status: "ok", headless: false, canRollback: false });
    expect(s.sidecars).toHaveLength(4);
    expect(s.sidecars[0]).toMatchObject({ status: "ok", mtls: expect.anything() });
    expect(data("mesh_status", { instance: "app-portal-1" }).sidecars).toHaveLength(1);
  });

  test("a retry storm can be rolled back, and the control plane then says it can no longer be", () => {
    const { data, inject, physics, world } = lab("mesh");
    const control = [...world.index.ofKind("mesh_control")][0]?.id as string;
    inject("retry_storm", control, { multiplier: 5 });
    physics.run(60);
    expect(data("mesh_status").controls[0].canRollback).toBe(true);
    const r = data("mesh_rollback");
    expect(r.control).toBe(control);
    expect(r.note).toContain("이전 설정으로 되돌렸어요");
    physics.run(60);
    expect(data("mesh_status").controls[0].canRollback).toBe(false);
  });

  test("a control plane that is down is headless", () => {
    const { data, inject, physics, world } = lab("mesh");
    inject("mesh_control_down", [...world.index.ofKind("mesh_control")][0]?.id as string);
    physics.run(60);
    expect(data("mesh_status").controls[0]).toMatchObject({ status: "down", headless: true });
  });
});

describe("region_failover sends all the traffic to one region [REQ-100]", () => {
  test("a thing that is not a region is refused with the regions there are", () => {
    const { raw } = lab("multiregion");
    expect(raw("region_failover", { region: "srv-a1" }).error).toMatch(/리전이 아니에요 \(.+\)/);
  });

  test("a region is chosen and the note says what happens to the sessions of the other", () => {
    const { data, world } = lab("multiregion");
    const region = [...world.index.ofKind("region")][0]?.id as string;
    const r = data("region_failover", { region });
    expect(r.region).toBe(region);
    expect(r.note).toContain("세션은 사라져");
  });
});
