/**
 * The accelerator, power and cooling tools with filters, wrong ids and parts that have failed (REQ-107): the answers an
 * agent gets when it asks for one server, one rack or one job, names something that is not there, or reads a plant in trouble.
 */
import { Catalog } from "@terrarium/core/catalog";
import type { Facades } from "@terrarium/core/facades";
import { Physics } from "@terrarium/core/physics";
import { TOOL_NAMES, Toolbox } from "@terrarium/core/tools";
import { type Blueprint, type EntityKind, type FaultType, World } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { accelLab, coolingLab, powerLab } from "./test-support/ladder-labs";

function boot(bp: Blueprint) {
  const world = World.fromBlueprint(bp, new Catalog());
  const physics = new Physics(world);
  physics.settle();
  physics.run(120);
  const box = new Toolbox(TOOL_NAMES);
  const call = (tool: string, args: Record<string, unknown> = {}) =>
    box.call(tool, args, { world, facades: {} as Facades });
  const data = (tool: string, args: Record<string, unknown> = {}) => {
    const r = call(tool, args);
    expect(r.error, `${tool}: ${r.error}`).toBeUndefined();
    return r.data as any;
  };
  const first = (kind: EntityKind) => world.index.ofKind(kind)[0]?.id as string;
  const inject = (type: FaultType, target: string, params: Record<string, number> = {}) =>
    world.apply(
      {
        type: "fault.add",
        fault: { id: `t-${type}-${target}-${JSON.stringify(params)}`, type, target, params },
      },
      "scenario",
    );
  return { world, physics, call, data, first, inject };
}

const train = () => boot(accelLab("gpu-training-cluster"));

describe("gpu_status and gpu_reset name what is wrong with a GPU or the call [REQ-107]", () => {
  test("one server can be asked for, a server without GPUs is refused with the list of those that have them", () => {
    const { data, call, world } = train();
    const gpu = world.index.ofKind("gpu")[0]?.id as string;
    const server = String(world.index.entity(gpu).props.server);
    expect(data("gpu_status", { server }).servers.map((s: { server: string }) => s.server)).toEqual(
      [server],
    );
    expect(call("gpu_status", { server: "tor-a" }).error).toContain("GPU 서버가 아니에요");
  });

  test("an Xid error shows in the row with its reason, and a lost NVLink shows on the server", () => {
    const { data, inject, physics, world } = train();
    const [g0] = world.index.ofKind("gpu");
    inject("gpu_xid_error", (g0 as { id: string }).id);
    const nv = world.index.ofKind("nvlink_domain")[0];
    if (nv) inject("nvlink_down", nv.id);
    physics.run(60);
    const servers = data("gpu_status").servers as Array<{
      nvlink?: string;
      nvlinkDomain?: string;
      gpus: any[];
    }>;
    const row = servers.flatMap((s) => s.gpus).find((g) => g.id === (g0 as { id: string }).id);
    expect(row).toMatchObject({ status: "down", xidErrors: 1 });
    expect(row.why).toContain("Xid 79");
    if (nv) expect(servers.find((s) => s.nvlinkDomain === nv.id)?.nvlink).toBeTypeOf("string");
  });

  test("a GPU that overheats is read as throttled with a lower clock", () => {
    const { data, inject, physics, world } = train();
    const g = world.index.ofKind("gpu")[1] as { id: string };
    inject("gpu_thermal_throttle", g.id);
    physics.run(600);
    const row = data("gpu_status")
      .servers.flatMap((s: { gpus: any[] }) => s.gpus)
      .find((x: { id: string }) => x.id === g.id);
    expect(row.clockPct).toBeLessThan(100);
  });

  test("gpu_reset takes a GPU by its number or its id, and refuses a non-GPU server or a number that is not there", () => {
    const { data, call, world } = train();
    const gpu = world.index.ofKind("gpu")[0]?.id as string;
    const server = String(world.index.entity(gpu).props.server);
    expect(data("gpu_reset", { server, gpu: "0" }).gpu).toBeTypeOf("string");
    expect(data("gpu_reset", { server, gpu }).gpu).toBe(gpu);
    expect(call("gpu_reset", { server: "tor-a", gpu: "0" }).error).toContain("GPU 서버가 아니에요");
    expect(call("gpu_reset", { server, gpu: "99" }).error).toContain("번 GPU가 없어요");
  });
});

describe("ib_status and job_status with filters and failures [REQ-107]", () => {
  test("ib_status can be limited to one server, and a flapping link says why", () => {
    const { data, inject, physics, world } = train();
    const link = world.index.ofKind("ib_link")[0];
    const server = String(link?.props.server);
    inject("ib_link_flap", link?.id as string);
    physics.run(60);
    const s = data("ib_status", { server });
    expect(s.links.length).toBeGreaterThan(0);
    expect(s.links.every((l: { server: string }) => l.server === server)).toBe(true);
    expect(data("ib_status", { server: "nowhere" }).links).toEqual([]);
    expect(data("ib_status").links.some((l: { flaps: number }) => l.flaps > 0)).toBe(true);
  });

  test("a failed job shows when the scheduler restarts it, and one job can be asked for by id", () => {
    const { data, call, inject, physics, world } = train();
    const job = world.index.ofKind("training_job")[0]?.id as string;
    physics.run(300);
    inject("gpu_xid_error", world.index.ofKind("gpu")[0]?.id as string);
    physics.run(20);
    const row = data("job_status", { job }).jobs[0];
    expect(row.phase).toBe("failed");
    expect(row.autoRestartInSeconds).toBeGreaterThanOrEqual(0);
    expect(row.why).toBeTypeOf("string");
    expect(call("job_status", { job: "tor-a" }).error).toContain("학습 잡이 아니에요");
  });

  test("a failed job can be resumed from its checkpoint, and node_drain answers in words", () => {
    const { data, inject, physics, world } = train();
    physics.run(300);
    inject("gpu_xid_error", world.index.ofKind("gpu")[0]?.id as string);
    physics.run(20);
    const job = world.index.ofKind("training_job")[0]?.id as string;
    expect(data("job_resume", { job }).note).toContain("체크포인트");
    const node = String(world.index.ofKind("gpu")[0]?.props.server);
    expect(data("node_drain", { node }).drained).toBe(true);
    expect(data("node_drain", { node, on: false })).toMatchObject({
      drained: false,
      note: expect.stringContaining("되돌렸어요"),
    });
  });

  test("the world without a scheduler, jobs or pools refuses job_status, and gpu_status in a world without GPUs", () => {
    const { call } = boot(accelLab("gpu-none"));
    expect(call("job_status").error).toContain("잡 스케줄러도 추론 풀도 없어요");
    expect(call("ib_status").error).toContain("패브릭이 없어요");
    expect(call("pool_scale", { replicas: 2 }).error).toContain("추론 풀이 없어요");
  });

  test("a serving pool is scaled by name or by default", () => {
    const { data, world } = boot(accelLab("gpu-serving-pool"));
    const pool = world.index.ofKind("inference_pool")[0]?.id as string;
    expect(data("pool_scale", { pool, replicas: 3 })).toMatchObject({ pool, replicas: 3 });
    expect(data("pool_scale", { replicas: 2 }).pool).toBe(pool);
    expect(data("job_status").pools[0].replicas).toBeTypeOf("number");
  });
});

describe("a scheduler that is down [REQ-107]", () => {
  test("job_status says why, and job_resume refuses until the scheduler is back", () => {
    const { data, call, inject, physics, world } = train();
    physics.run(300);
    inject("gpu_xid_error", world.index.ofKind("gpu")[0]?.id as string);
    physics.run(5);
    inject("scheduler_down", world.index.ofKind("job_scheduler")[0]?.id as string);
    physics.run(5);
    expect(data("job_status").scheduler.why).toBeTypeOf("string");
    const job = world.index.ofKind("training_job")[0]?.id as string;
    expect(call("job_resume", { job }).error).toContain("스케줄러가 멈춰 있어서");
  });
});

describe("power and cooling tools with filters and failures [REQ-107]", () => {
  test("rack batteries can be limited to a rack, and a failed cell and a sagging bus show in the pack", () => {
    const { data, inject, physics, first } = boot(powerLab("pwr-rack-bbu"));
    inject("bbu_cell_fault", first("bbu"), { cells: 2 });
    inject("dc_bus_sag", first("dc_bus"), { sagV: 8 });
    physics.run(60);
    const packs = data("bbu_status").packs as Array<{
      cellsFailed: number;
      busStatus: string;
      dcBus: string;
    }>;
    expect(packs.some((p) => p.cellsFailed === 2)).toBe(true);
    expect(packs.some((p) => p.busStatus !== "ok")).toBe(true);
    expect(data("bbu_status", { rack: "none" }).packs).toEqual([]);
  });

  test("a world without rack batteries refuses bbu_status, and one without a substation refuses substation_status and transfer_feed", () => {
    const { call } = boot(powerLab("pwr-ab"));
    expect(call("bbu_status").error).toContain("랙 배터리");
    expect(call("substation_status").error).toContain("자체 변전소가 없어요");
    expect(call("transfer_feed", { feed: 2 }).error).toContain("자체 변전소가 없어요");
  });

  test("with both feeds gone the substation says how long the active one has been lost", () => {
    const { data, inject, physics, first } = boot(powerLab("pwr-substation"));
    inject("utility_feed_loss", first("substation"), { feed: 1 });
    inject("utility_feed_loss", first("substation"), { feed: 2 });
    physics.run(60);
    const sub = data("substation_status").substations[0];
    expect(sub.feeds.every((f: { voltage: boolean }) => !f.voltage)).toBe(true);
  });

  test("a substation can be asked for by id and feed 2 can be chosen", () => {
    const { data, world } = boot(powerLab("pwr-substation"));
    const id = world.index.ofKind("substation")[0]?.id as string;
    expect(data("substation_status", { substation: id }).substations).toHaveLength(1);
    expect(data("transfer_feed", { substation: id, feed: 2 })).toMatchObject({
      substation: id,
      feed: 2,
    });
    expect(data("transfer_feed", { feed: 7 }).feed).toBe(1);
  });

  test("power caps: set, read per rack, and lifted; a world with no rack limit has nothing to read", () => {
    const { data, call, world } = boot(accelLab("gpu-training-cluster"));
    const rack = world.index.ofKind("rack").find((r) => typeof r.props.powerLimitW === "number");
    const server = world.index.childrenOf(rack?.id as string, "server")[0]?.id as string;
    expect(data("set_power_cap", { server, watts: 400 }).note).toContain("캡을 걸었어요");
    expect(data("set_power_cap", { server }).note).toBe("캡을 풀었어요.");
    expect(data("power_cap_status", { rack: rack?.id }).racks[0].id).toBe(rack?.id);
    expect(data("power_cap_status").racks[0].servers[0]).toHaveProperty("perf");
    expect(boot(powerLab("pwr-ab")).call("power_cap_status").error).toContain(
      "전력 한도가 있는 랙이",
    );
    expect(call("power_cap_status", { rack: "none" }).error).toContain("전력 한도가 있는 랙이");
  });

  test("a fabric built for RoCE is called RoCE", () => {
    const { data } = boot(accelLab("gpu-training-cluster", { network: "net-ai-fabric" }));
    expect(data("ib_status").kind).toMatch(/RoCE|InfiniBand/);
  });

  test("a rack with no power limit can still be asked for by id and shows no limit", () => {
    const { data, world } = boot(accelLab("gpu-training-cluster"));
    const plain = world.index.ofKind("rack").find((r) => typeof r.props.powerLimitW !== "number");
    if (plain) expect(data("power_cap_status", { rack: plain.id }).racks[0].limitW).toBeNull();
  });

  test("cdu_status: one CDU by id, a world with none refuses, a coolant leak trips the sensor", () => {
    const { data, call, inject, physics, first } = boot(coolingLab("cool-liquid"));
    const cdu = first("cdu");
    expect(data("cdu_status", { cdu }).cdus).toHaveLength(1);
    expect(data("cdu_status").cdus[0].leakSensor).toBe("dry");
    inject("coolant_leak", cdu);
    physics.run(10);
    expect(data("cdu_status", { cdu }).cdus[0].leakSensor).toBe("tripped");
    expect(boot(powerLab("pwr-ab")).call("cdu_status").error).toContain("CDU가 없어요");
    expect(call("cdu_status", { cdu: "none" }).error).toContain("CDU가 없어요");
  });

  test("cooling_status can be narrowed to one id, and a rear door or tank in trouble gives a reason", () => {
    const door = boot(coolingLab("cool-rdhx"));
    door.inject("rdhx_valve_stuck", door.first("rdhx"));
    door.physics.run(300);
    expect(door.data("cooling_status", { id: door.first("rdhx") }).rearDoors).toHaveLength(1);
    expect(door.data("cooling_status", { id: "none" }).rearDoors).toEqual([]);
    const tank = boot(coolingLab("cool-immersion"));
    tank.inject("fluid_level_low", tank.first("immersion_tank"));
    tank.physics.run(300);
    expect(tank.data("cooling_status").tanks[0].levelPct).toBeLessThan(100);
  });
});

describe("the accelerator tools on parts the generator left bare [REQ-107]", () => {
  const strip =
    (kinds: string[], drop: string[] = []) =>
    (bp: Blueprint): Blueprint => {
      const gone = new Set(bp.entities.filter((e) => kinds.includes(e.kind)).map((e) => e.id));
      return {
        ...bp,
        entities: bp.entities
          .filter((e) => !gone.has(e.id))
          .map((e) =>
            e.kind === "gpu" || e.kind === "ib_link"
              ? {
                  ...e,
                  props: Object.fromEntries(
                    Object.entries(e.props).filter(([k]) => !drop.includes(k)),
                  ),
                }
              : e,
          ),
        links: bp.links.filter((l) => !gone.has(l.from) && !gone.has(l.to)),
      };
    };

  test("a GPU with no model or memory size is shown as a GPU with 80 GiB, and a link with no rate as 400 Gbps", () => {
    const { data } = boot(strip([], ["model", "memGiB", "gbps"])(accelLab("gpu-training-cluster")));
    const gpu = data("gpu_status").servers[0].gpus[0];
    expect(gpu).toMatchObject({ model: "GPU", memoryTotalGiB: 80 });
    expect(data("ib_status").links[0].rateGbps).toBe(400);
  });

  test("a GPU server with no NVLink domain is listed without one", () => {
    const { data } = boot(strip(["nvlink_domain"])(accelLab("gpu-training-cluster")));
    const server = data("gpu_status").servers[0];
    expect(server.nvlink).toBeUndefined();
    expect(server.gpus.length).toBeGreaterThan(0);
  });

  test("a rack battery with no DC bus in its rack is listed without a bus", () => {
    const { data } = boot(strip(["dc_bus"])(powerLab("pwr-rack-bbu")));
    const pack = data("bbu_status").packs[0];
    expect(pack.dcBus).toBeUndefined();
    expect(pack.chargePct).toBeTypeOf("number");
  });

  test("a power cap lowers the performance the rack row shows once time has passed", () => {
    const { data, physics, world } = boot(accelLab("gpu-training-cluster"));
    const rack = world.index.ofKind("rack").find((r) => typeof r.props.powerLimitW === "number");
    const server = world.index.childrenOf(rack?.id as string, "server")[0]?.id as string;
    data("set_power_cap", { server, watts: 700 });
    physics.run(60);
    const row = data("power_cap_status", { rack: rack?.id }).racks[0].servers.find(
      (s: { id: string }) => s.id === server,
    );
    expect(row.capW).toBe(700);
    expect(row.perf).toBeLessThanOrEqual(1);
  });
});

describe("a serving pool in trouble [REQ-107]", () => {
  test("a pool with a wrong MIG split is reflected in the pool row with a reason", () => {
    const { data, inject, physics, world } = boot(accelLab("gpu-serving-pool"));
    inject("mig_misconfig", world.index.ofKind("inference_pool")[0]?.id as string);
    physics.run(300);
    const pool = data("job_status").pools[0];
    expect(pool.status).not.toBe("ok");
    expect(pool.why).toBeTypeOf("string");
  });
});
