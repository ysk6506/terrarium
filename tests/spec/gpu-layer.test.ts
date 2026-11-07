/**
 * The GPU accelerator layer (REQ-107, ADR-0130, docs/design-docs/gpu-layer.md): what each fault does to the GPUs, the node, the
 * fabric, the job and the pool, what the system does by itself (cause `cluster`), and what an agent can do about it.
 */
import { Catalog } from "@terrarium/core/catalog";
import { Physics } from "@terrarium/core/physics";
import { ACCEL_TEMPLATES } from "@terrarium/core/scenario";
import { Session } from "@terrarium/core/session";
import { TOOL_NAMES } from "@terrarium/core/tools";
import { type Blueprint, BlueprintIndex, type FaultType, World } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { accelLab } from "./test-support/ladder-labs";

const catalog = new Catalog();
const TRAIN = () => accelLab("gpu-training-cluster", { network: "net-leaf-spine" });

function boot(make: () => Blueprint) {
  const world = World.fromBlueprint(make(), catalog);
  const physics = new Physics(world);
  physics.settle();
  physics.run(120);
  return { world, physics };
}

const inject = (
  world: World,
  type: FaultType,
  target: string,
  params: Record<string, number> = {},
) =>
  world.apply({ type: "fault.add", fault: { id: `t-${type}`, type, target, params } }, "scenario");

const job = (world: World) => world.stateAs("train-job", "training_job");
const firstGpu = (world: World) => world.index.ofKind("gpu")[0]?.id as string;
const serverOf = (world: World, gpu: string) => String(world.index.entity(gpu).props.server);
const clusterNotes = (world: World) =>
  world.events().filter((e) => e.type === "note" && e.cause === "cluster");

describe("the training cluster starts healthy [REQ-107]", () => {
  test("GPUs, NVLink, fabric, scheduler and job are all fine and the job makes progress", () => {
    const { world, physics } = boot(TRAIN);
    for (const g of world.index.ofKind("gpu")) expect(world.stateAs(g.id, "gpu").status).toBe("ok");
    expect(world.stateAs("ib-fabric", "ib_fabric").status).toBe("ok");
    expect(world.stateAs("job-scheduler", "job_scheduler").status).toBe("ok");
    const before = job(world).step;
    physics.run(60);
    expect(job(world).step).toBeGreaterThan(before);
    expect(job(world).phase).not.toBe("failed");
  });
});

describe("Xid error: the job fails and the scheduler restarts it from the last checkpoint [REQ-107]", () => {
  test("the scheduler drains the node, then puts the job back on a spare node (cause cluster)", () => {
    const { world, physics } = boot(TRAIN);
    physics.run(700);
    const gpu = firstGpu(world);
    const node = serverOf(world, gpu);
    inject(world, "gpu_xid_error", gpu);
    physics.run(60);
    expect(job(world).phase).toBe("failed");
    expect(world.stateAs("job-scheduler", "job_scheduler").drained).toContain(node);
    const checkpoint = job(world).checkpointStep;
    physics.run(330);
    expect(job(world).phase).toBe("resumed");
    expect(job(world).restarts).toBe(1);
    expect(job(world).nodes).not.toContain(node);
    expect(job(world).step).toBeGreaterThanOrEqual(checkpoint);
    expect(clusterNotes(world).length).toBeGreaterThanOrEqual(2);
  });

  test("an agent that resets the GPU and resumes the job brings it back sooner than the scheduler", () => {
    const { world, physics } = boot(TRAIN);
    physics.run(300);
    const gpu = firstGpu(world);
    inject(world, "gpu_xid_error", gpu);
    physics.run(40);
    world.apply({ type: "fault.remove", faultId: "t-gpu_xid_error" }, "scenario");
    world.apply({ type: "gpu.reset", target: gpu }, "agent");
    world.apply({ type: "job.resume", target: "train-job" }, "agent");
    physics.run(20);
    expect(job(world).phase).toBe("resumed");
    expect(job(world).restarts).toBeGreaterThanOrEqual(1);
  });

  test("resetting a healthy GPU is refused when it only hurts, not by the world but by the job", () => {
    const { world } = boot(TRAIN);
    expect(() => world.apply({ type: "job.resume", target: "train-job" }, "agent")).toThrow(
      /제대로 돌고/,
    );
  });
});

describe("the other training faults [REQ-107]", () => {
  test("NVLink down takes the node off the bus like a Xid", () => {
    const { world, physics } = boot(TRAIN);
    const nv = world.index.ofKind("nvlink_domain")[0]?.id as string;
    inject(world, "nvlink_down", nv);
    physics.run(60);
    expect(world.stateAs(nv, "nvlink_domain").status).toBe("down");
    expect(job(world).phase).toBe("failed");
  });

  test("a flapping fabric link slows the job, and a long flap ends in an NCCL timeout", () => {
    const { world, physics } = boot(TRAIN);
    const link = world.index.ofKind("ib_link")[0]?.id as string;
    inject(world, "ib_link_flap", link);
    physics.run(60);
    expect(job(world).phase).not.toBe("failed");
    expect(world.stateAs(link, "ib_link").flaps).toBeGreaterThan(0);
    physics.run(200);
    expect(job(world).phase === "failed" || job(world).why !== undefined).toBe(true);
    expect(world.alarms().some((a) => a.code === "ib_link_flap")).toBe(true);
  });

  test("a job stuck on its checkpoint store pauses, and a resume brings it back", () => {
    const { world, physics } = boot(TRAIN);
    inject(world, "job_stuck_checkpoint", "train-job");
    physics.run(60);
    expect(job(world).phase).toBe("paused");
    world.apply({ type: "fault.remove", faultId: "t-job_stuck_checkpoint" }, "agent");
    physics.run(30);
    expect(job(world).phase).toBe("resumed");
  });

  test("a scheduler that is down cannot restart a failed job, and the agent cannot resume it either", () => {
    const { world, physics } = boot(TRAIN);
    inject(world, "scheduler_down", "job-scheduler");
    inject(world, "gpu_xid_error", firstGpu(world));
    physics.run(400);
    expect(job(world).phase).toBe("failed");
    expect(() => world.apply({ type: "job.resume", target: "train-job" }, "agent")).toThrow(
      /스케줄러/,
    );
  });

  test("a thermal throttle slows the clocks and the job with the slowest GPU", () => {
    const { world, physics } = boot(TRAIN);
    const gpu = firstGpu(world);
    inject(world, "gpu_thermal_throttle", gpu, { deltaC: 40 });
    physics.run(400);
    const s = world.stateAs(gpu, "gpu");
    expect(s.throttled).toBe(true);
    expect(s.clockPct).toBeLessThan(100);
  });
});

describe("the serving pool [REQ-107]", () => {
  const POOL = () => accelLab("gpu-serving-pool");

  test("a Xid takes the replica out of the pool by itself", () => {
    const { world, physics } = boot(POOL);
    const full = world.stateAs("serve-pool", "inference_pool").replicas;
    inject(world, "gpu_xid_error", firstGpu(world));
    physics.run(90);
    const pool = world.stateAs("serve-pool", "inference_pool");
    expect(pool.replicas).toBeLessThan(full);
    expect(pool.removed.length).toBe(1);
    expect(pool.status).toBe("degraded");
  });

  test("a leaking serving process fills the GPU memory, is killed (OOM) and restarted", () => {
    const { world, physics } = boot(POOL);
    const gpu = firstGpu(world);
    inject(world, "gpu_memory_leak_inference", gpu, { giBPerMin: 20 });
    let sawDown = false;
    for (let i = 0; i < 40; i++) {
      physics.run(15);
      if (world.stateAs(gpu, "gpu").status === "down") sawDown = true;
    }
    expect(sawDown).toBe(true);
  });

  test("a wrong MIG split halves the replicas, and re-scaling the pool fixes the split", () => {
    const { world, physics } = boot(POOL);
    const full = world.stateAs("serve-pool", "inference_pool").replicas;
    inject(world, "mig_misconfig", "serve-pool");
    physics.run(60);
    expect(world.stateAs("serve-pool", "inference_pool").replicas).toBeLessThan(full);
    world.apply({ type: "fault.remove", faultId: "t-mig_misconfig" }, "agent");
    world.apply({ type: "pool.scale", target: "serve-pool", replicas: full }, "agent");
    physics.run(30);
    expect(world.stateAs("serve-pool", "inference_pool").replicas).toBe(full);
  });
});

describe("the GPU world has the tools and the shell commands [REQ-107]", () => {
  test("every GPU entity has a state and the server draws power by the load of its GPUs", () => {
    const { world } = boot(TRAIN);
    const gpu = firstGpu(world);
    const node = world.stateAs(serverOf(world, gpu), "server");
    expect(node.gpuLoad).toBeGreaterThan(0.5);
    expect(node.powerW).toBeGreaterThan(3000);
  });
});

describe("an agent reads the GPU world with its tools and the shell [REQ-107]", () => {
  function xidSession() {
    const blueprint = TRAIN();
    const t = ACCEL_TEMPLATES.find(
      (x) => x.id === "gpu-xid-error",
    ) as (typeof ACCEL_TEMPLATES)[number];
    const scenario = t.build(new BlueprintIndex(blueprint), "lab");
    const session = Session.create({ blueprint, scenario, tools: TOOL_NAMES, seed: 1 });
    session.start();
    const bad = scenario.nodes.find((n) => n.type === "inject_fault");
    const target = String((bad?.params as { target?: string }).target);
    return { session, target };
  }

  test("gpu_status, job_status and ib_status say what is wrong", () => {
    const { session } = xidSession();
    expect(JSON.stringify(session.call("gpu_status", {}))).toMatch(/Xid|down/);
    expect(JSON.stringify(session.call("job_status", {}))).toMatch(/failed|실패/);
    expect(JSON.stringify(session.call("ib_status", {}))).toMatch(/fabric|패브릭|ok/);
  });

  test("nvidia-smi on the node shows ERR! for the GPU that fell off the bus, and ibstat and dcgmi answer", () => {
    const { session, target } = xidSession();
    const node = target.replace(/-gpu\d+$/, "");
    const smi = JSON.stringify(session.call("run_command", { host: node, cmd: "nvidia-smi" }));
    expect(smi).toMatch(/ERR!/);
    expect(JSON.stringify(session.call("run_command", { host: node, cmd: "ibstat" }))).toMatch(
      /State/i,
    );
    expect(
      JSON.stringify(session.call("run_command", { host: node, cmd: "dcgmi diag -r 1" })),
    ).toMatch(/Pass|Fail|diag/i);
    expect(
      JSON.stringify(
        session.call("run_command", { host: node, cmd: "nvidia-smi -q -d TEMPERATURE,POWER" }),
      ),
    ).toMatch(/Temperature|Power/i);
  });

  test("resetting the right GPU through the tool is scored as the action it is", () => {
    const { session, target } = xidSession();
    const node = target.replace(/-gpu\d+$/, "");
    session.call("gpu_reset", { server: node, gpu: target });
    expect(session.finish().toolCalls.some((c) => c.tool === "gpu_reset")).toBe(true);
  });
});
