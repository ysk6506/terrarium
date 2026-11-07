/**
 * The alarms of the accelerator layer and of the power and cooling ladders (REQ-107): a GPU that fell off the bus, ran out of
 * memory or slowed its clocks, a broken NVLink or fabric link, a scheduler that is down, a job that failed or is stuck, a pool
 * that lost replicas; a rack battery on its cells, a bus under voltage, a substation on one feed, a rear door, a tank. They sit on
 * the entity they are about, so a diagnosis can name it and the topology can colour it.
 */
import type { Entity, EntityKind, World } from "@terrarium/core/world";
import type { Draft } from "./alarm-scan";

const say = (e: Entity, code: string, severity: "critical" | "warning", text: string): Draft => ({
  entityId: e.id,
  code,
  severity,
  message: `${e.name}: ${text}`,
});

interface Rule {
  /** Alarm code when the entity is down, and when it is only degraded. */
  readonly down: string;
  readonly warn: string;
  /** What to say when the state has no reason of its own. */
  readonly plain: string;
}

/** One alarm for every entity of a kind whose status is not ok. */
function statusAlarms(world: World, out: Draft[], kind: EntityKind, rule: Rule): void {
  for (const e of world.index.ofKind(kind)) {
    const s = world.stateAs(e.id, kind) as { status: string; why?: string };
    if (s.status === "ok") continue;
    const down = s.status === "down";
    out.push(
      say(e, down ? rule.down : rule.warn, down ? "critical" : "warning", s.why ?? rule.plain),
    );
  }
}

function gpuAlarms(world: World, out: Draft[]): void {
  for (const e of world.index.ofKind("gpu")) {
    const s = world.stateAs(e.id, "gpu");
    if (s.status === "down" && s.why !== "서버가 꺼져 있어요")
      out.push(say(e, "gpu_down", "critical", s.why ?? "GPU가 떨어졌어요"));
    else if (s.status === "degraded")
      out.push(
        say(
          e,
          s.throttled ? "gpu_throttled" : "gpu_memory_high",
          "warning",
          s.why ?? "GPU 상태가 좋지 않아요",
        ),
      );
  }
  nvlinkAlarms(world, out);
  for (const e of world.index.ofKind("ib_link")) {
    const s = world.stateAs(e.id, "ib_link");
    if (s.flaps > 0 && s.why !== "서버가 꺼져 있어요")
      out.push(
        say(
          e,
          "ib_link_flap",
          "warning",
          `링크가 ${s.flaps}번 끊겼다 붙었어요${s.status === "down" ? "(지금 끊겨 있어요)" : ""}`,
        ),
      );
  }
}

function nvlinkAlarms(world: World, out: Draft[]): void {
  for (const e of world.index.ofKind("nvlink_domain"))
    if (world.stateAs(e.id, "nvlink_domain").status === "down")
      out.push({
        entityId: e.id,
        code: "nvlink_down",
        severity: "critical",
        message: `${e.name}가 끊겼어요 — GPU끼리 빠르게 주고받지 못해요`,
      });
}

const because = (why: string | undefined): string => (why ? ` — ${why}` : "");

function jobAlarms(world: World, out: Draft[]): void {
  for (const e of world.index.ofKind("job_scheduler"))
    if (world.stateAs(e.id, "job_scheduler").status === "down")
      out.push({
        entityId: e.id,
        code: "scheduler_down",
        severity: "critical",
        message: `${e.name}가 멈췄어요 — 잡을 새로 올리거나 다시 올리지 못해요`,
      });
  for (const e of world.index.ofKind("training_job")) {
    const s = world.stateAs(e.id, "training_job");
    if (s.phase === "failed")
      out.push({
        entityId: e.id,
        code: "job_failed",
        severity: "critical",
        message: `${e.name}이(가) 실패했어요${because(s.why)}`,
      });
    else if (s.phase === "paused")
      out.push({
        entityId: e.id,
        code: "job_paused",
        severity: "warning",
        message: `${e.name}이(가) 멈춰 있어요${because(s.why)}`,
      });
  }
  statusAlarms(world, out, "inference_pool", {
    down: "pool_down",
    warn: "pool_degraded",
    plain: "추론 풀 상태가 좋지 않아요",
  });
}

function facilityAlarms(world: World, out: Draft[]): void {
  statusAlarms(world, out, "bbu", {
    down: "bbu_empty",
    warn: "bbu_degraded",
    plain: "배터리 상태가 좋지 않아요",
  });
  statusAlarms(world, out, "dc_bus", {
    down: "dc_bus_sag",
    warn: "dc_bus_sag",
    plain: "전압이 낮아요",
  });
  statusAlarms(world, out, "substation", {
    down: "substation_down",
    warn: "substation_degraded",
    plain: "변전소 상태가 좋지 않아요",
  });
  for (const e of world.index.ofKind("rdhx")) {
    const s = world.stateAs(e.id, "rdhx");
    if (s.status === "degraded")
      out.push(say(e, "rdhx_valve", "warning", s.why ?? "리어도어 상태가 좋지 않아요"));
  }
  statusAlarms(world, out, "immersion_tank", {
    down: "tank_hot",
    warn: "tank_degraded",
    plain: "액침 탱크 상태가 좋지 않아요",
  });
}

/** The alarms of every GPU, fabric part, scheduler, job, pool, battery, bus, substation, rear door and tank. */
export function accelAlarms(world: World, out: Draft[]): void {
  gpuAlarms(world, out);
  jobAlarms(world, out);
  facilityAlarms(world, out);
}
