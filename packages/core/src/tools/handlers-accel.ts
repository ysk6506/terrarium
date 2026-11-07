/**
 * The handlers of the accelerator, power and cooling tools (REQ-107): the status tools say what nvidia-smi, ibstat, the
 * scheduler or a facility panel would show an operator, from the state the physics keeps; the actions give a command to the
 * world and say plainly what happens next.
 */
import { InvalidValueError } from "@terrarium/core/kernel";
import { Accel, type Entity, type WorldPort } from "@terrarium/core/world";
import type { Args, ToolContext } from "./handlers";

type Handler = (ctx: ToolContext, args: Args) => unknown;

const opt = (args: Args, key: string): string | undefined =>
  args[key] === undefined || args[key] === "" ? undefined : String(args[key]);
const need = (args: Args, key: string): string => String(args[key] ?? "");
const r1 = (n: number): number => Math.round(n * 10) / 10;
const byId = (a: Entity, b: Entity): number => a.id.localeCompare(b.id);

/** The servers that carry GPUs, by id. */
function gpuServers(world: WorldPort): string[] {
  return [...new Set(world.index.ofKind("gpu").map((g) => Accel.serverOfAccel(g)))].sort();
}

function gpuRow(world: WorldPort, g: Entity, index: number) {
  const s = world.stateAs(g.id, "gpu");
  return {
    id: g.id,
    gpu: index,
    model: g.props.model ?? "GPU",
    status: s.status,
    ...(s.why ? { why: s.why } : {}),
    tempC: r1(s.tempC),
    powerW: Math.round(s.powerW),
    utilPct: s.utilPct,
    memoryUsedGiB: r1(s.memUsedGiB),
    memoryTotalGiB: g.props.memGiB ?? 80,
    xidErrors: s.xidErrors,
    clockPct: Math.round(s.clockPct),
    throttled: s.throttled,
    resets: s.resets,
  };
}

const gpuStatus: Handler = (ctx, args) => {
  const { world } = ctx;
  const all = gpuServers(world);
  if (all.length === 0) throw new InvalidValueError("이 세계에는 GPU가 없어요");
  const only = opt(args, "server");
  if (only && !all.includes(only))
    throw new InvalidValueError(`'${only}'는 GPU 서버가 아니에요 (${all.join(", ")})`);
  return {
    servers: (only ? [only] : all).map((server) => {
      const nv = Accel.nvlinkOf(world.index, server);
      return {
        server,
        ...(nv
          ? { nvlink: world.stateAs(nv.id, "nvlink_domain").status, nvlinkDomain: nv.id }
          : {}),
        gpus: Accel.gpusOf(world.index, server).map((g, i) => gpuRow(world, g, i)),
      };
    }),
  };
};

const gpuReset: Handler = (ctx, args) => {
  const { world } = ctx;
  const server = need(args, "server");
  const which = need(args, "gpu");
  const gpus = Accel.gpusOf(world.index, server);
  if (gpus.length === 0) throw new InvalidValueError(`'${server}'는 GPU 서버가 아니에요`);
  const gpu =
    world.index.find(which)?.kind === "gpu" ? world.index.find(which) : gpus[Number(which)];
  if (!gpu || Accel.serverOfAccel(gpu) !== server)
    throw new InvalidValueError(`'${server}'에 ${which}번 GPU가 없어요 (0~${gpus.length - 1})`);
  world.apply({ type: "gpu.reset", target: gpu.id }, "tool:gpu_reset");
  return {
    server,
    gpu: gpu.id,
    note: "GPU를 리셋했어요. 그 노드에서 돌던 프로세스는 죽었어요(학습 잡이면 실패해요). gpu_status로 돌아왔는지 확인하세요.",
  };
};

const ibStatus: Handler = (ctx, args) => {
  const { world } = ctx;
  const fabric = Accel.fabricOf(world.index);
  if (!fabric) throw new InvalidValueError("이 세계에는 InfiniBand/RoCE 패브릭이 없어요");
  const only = opt(args, "server");
  const f = world.stateAs(fabric.id, "ib_fabric");
  return {
    fabric: fabric.id,
    kind: fabric.props.fabric === "roce" ? "RoCE" : "InfiniBand",
    status: f.status,
    ...(f.why ? { why: f.why } : {}),
    links: [...world.index.ofKind("ib_link")]
      .filter((l) => !only || Accel.serverOfAccel(l) === only)
      .sort(byId)
      .map((l) => {
        const s = world.stateAs(l.id, "ib_link");
        return {
          id: l.id,
          server: Accel.serverOfAccel(l),
          state: s.status === "up" ? "Active" : "Down",
          rateGbps: l.props.gbps ?? 400,
          flaps: s.flaps,
          ...(s.why ? { why: s.why } : {}),
        };
      }),
  };
};

function jobRow(world: WorldPort, j: Entity) {
  const s = world.stateAs(j.id, "training_job");
  const def = Accel.jobDef(j);
  return {
    id: j.id,
    name: j.name,
    phase: s.phase,
    ...(s.why ? { why: s.why } : {}),
    nodes: s.nodes ?? def.nodes,
    spares: def.spares.filter((n) => !(s.nodes ?? def.nodes).includes(n)),
    step: Math.floor(s.step),
    checkpointStep: s.checkpointStep,
    checkpointAgeSeconds: Math.round(world.time() - s.checkpointAt),
    stepsLostSoFar: s.lostSteps,
    restarts: s.restarts,
    ...(s.phase === "failed" && s.failedAt !== undefined
      ? {
          autoRestartInSeconds: Math.max(
            0,
            Math.round(Accel.JOB_RESTART_S - (world.time() - s.failedAt)),
          ),
        }
      : {}),
  };
}

const jobStatus: Handler = (ctx, args) => {
  const { world } = ctx;
  const sched = Accel.schedulerOf(world.index);
  const jobs = Accel.jobsOf(world.index);
  const pools = Accel.poolsOf(world.index);
  if (!sched && jobs.length === 0 && pools.length === 0)
    throw new InvalidValueError("이 세계에는 잡 스케줄러도 추론 풀도 없어요");
  const only = opt(args, "job");
  if (only && world.index.find(only)?.kind !== "training_job")
    throw new InvalidValueError(
      `'${only}'는 학습 잡이 아니에요 (${jobs.map((j) => j.id).join(", ")})`,
    );
  const s = sched ? world.stateAs(sched.id, "job_scheduler") : undefined;
  return {
    ...(sched && s
      ? {
          scheduler: {
            id: sched.id,
            status: s.status,
            ...(s.why ? { why: s.why } : {}),
            queued: s.queued,
            running: s.running,
            drainedNodes: s.drained,
          },
        }
      : {}),
    jobs: jobs.filter((j) => !only || j.id === only).map((j) => jobRow(world, j)),
    pools: pools.map((p) => {
      const ps = world.stateAs(p.id, "inference_pool");
      return {
        id: p.id,
        name: p.name,
        status: ps.status,
        ...(ps.why ? { why: ps.why } : {}),
        replicas: ps.replicas,
        desired: ps.desired,
        capacity: Accel.poolCapacity(Accel.poolDef(p)),
        p50Ms: ps.p50Ms,
        p99Ms: ps.p99Ms,
        migSlices: ps.migSlices,
        removedServers: ps.removed,
      };
    }),
  };
};

const jobResume: Handler = (ctx, args) => {
  const target = need(args, "job");
  ctx.world.apply({ type: "job.resume", target }, "tool:job_resume");
  return {
    job: target,
    note: "마지막 체크포인트부터 다시 돌아요. 고장난 노드가 그대로면 또 실패해요. job_status로 확인하세요.",
  };
};

const nodeDrain: Handler = (ctx, args) => {
  const target = need(args, "node");
  const on = args.on === undefined ? true : args.on === true;
  ctx.world.apply({ type: "node.drain", target, on }, "tool:node_drain");
  return {
    node: target,
    drained: on,
    note: on
      ? "이 노드로는 새 잡이 올라가지 않아요. 돌던 잡이 실패하면 예비 노드로 옮겨 다시 올라가요. 고장은 그대로예요."
      : "이 노드를 스케줄에 되돌렸어요.",
  };
};

const poolScale: Handler = (ctx, args) => {
  const { world } = ctx;
  const named = opt(args, "pool");
  const pools = Accel.poolsOf(world.index);
  const target = named ?? pools[0]?.id;
  if (!target) throw new InvalidValueError("이 세계에는 추론 풀이 없어요");
  const replicas = Number(args.replicas);
  world.apply({ type: "pool.scale", target, replicas }, "tool:pool_scale");
  return {
    pool: target,
    replicas,
    note: "풀을 다시 나눠 복제본을 맞췄어요. job_status로 복제본과 지연을 확인하세요.",
  };
};

// ── power and cooling ──────────────────────────────────────────────────────

function substationRow(world: WorldPort, e: Entity) {
  const s = world.stateAs(e.id, "substation");
  return {
    id: e.id,
    name: e.name,
    status: s.status,
    ...(s.why ? { why: s.why } : {}),
    feeds: s.feeds.map((ok, i) => ({ feed: i + 1, voltage: ok, active: s.activeFeed === i + 1 })),
    transformers: s.transformersOk.map((ok, i) => ({
      transformer: i + 1,
      inService: ok,
      tempC: Math.round(s.transformerC[i] as number),
    })),
    loadPct: s.loadPct,
    ...(s.lostSince !== undefined
      ? { activeFeedLostForSeconds: Math.round(world.time() - s.lostSince) }
      : {}),
  };
}

function bbuRow(world: WorldPort, e: Entity) {
  const s = world.stateAs(e.id, "bbu");
  const rack = world.index
    .outgoing(e.id, "member_of")
    .find((l) => world.index.find(l.to)?.kind === "rack")?.to;
  const bus = world.index
    .ofKind("dc_bus")
    .find((b) => world.index.outgoing(b.id, "member_of").some((l) => l.to === rack));
  const b = bus ? world.stateAs(bus.id, "dc_bus") : undefined;
  return {
    id: e.id,
    rack,
    status: s.status,
    ...(s.why ? { why: s.why } : {}),
    chargePct: Math.round(s.chargePct),
    runtimeMinutes: s.runtimeMin,
    onBattery: s.onBattery,
    cellsFailed: s.cellsFailed,
    ...(bus && b ? { dcBus: bus.id, busVoltageV: b.voltageV, busStatus: b.status } : {}),
  };
}

const powerStatus: Handler = (ctx, args) => {
  const { world } = ctx;
  const only = opt(args, "id");
  const pick = (kind: Parameters<typeof world.index.ofKind>[0]) =>
    [...world.index.ofKind(kind)].filter((e) => !only || e.id === only).sort(byId);
  return {
    ups: pick("ups").map((e) => {
      const s = world.stateAs(e.id, "ups");
      return {
        id: e.id,
        name: e.name,
        inputOk: s.inputOk,
        onBattery: s.onBattery,
        batteryPct: Math.round(s.batteryPct),
        loadKw: r1(s.loadW / 1000),
      };
    }),
    generators: pick("generator").map((e) => {
      const s = world.stateAs(e.id, "generator");
      return {
        id: e.id,
        name: e.name,
        phase: s.phase,
        fuelPct: Math.round(s.fuelPct),
        loadKw: r1(s.loadKw),
      };
    }),
    substations: pick("substation").map((e) => substationRow(world, e)),
    rackBatteries: pick("bbu").map((e) => bbuRow(world, e)),
  };
};

const bbuStatus: Handler = (ctx, args) => {
  const { world } = ctx;
  const rack = opt(args, "rack");
  const packs = [...world.index.ofKind("bbu")].sort(byId);
  if (packs.length === 0) throw new InvalidValueError("이 세계에는 랙 배터리(BBU)가 없어요");
  return {
    packs: packs.map((e) => bbuRow(world, e)).filter((row) => !rack || row.rack === rack),
  };
};

const substationStatus: Handler = (ctx, args) => {
  const only = opt(args, "substation");
  const subs = [...ctx.world.index.ofKind("substation")]
    .filter((e) => only === undefined || e.id === only)
    .sort(byId);
  if (subs.length === 0) throw new InvalidValueError("이 세계에는 자체 변전소가 없어요");
  return { substations: subs.map((e) => substationRow(ctx.world, e)) };
};

const transferFeed: Handler = (ctx, args) => {
  const { world } = ctx;
  const target = opt(args, "substation") ?? [...world.index.ofKind("substation")][0]?.id;
  if (!target) throw new InvalidValueError("이 세계에는 자체 변전소가 없어요");
  const feed = Number(args.feed) === 2 ? 2 : 1;
  world.apply({ type: "feed.transfer", target, feed }, "tool:transfer_feed");
  return {
    substation: target,
    feed,
    note: `수전 ${feed}번 줄로 옮겼어요. substation_status로 변압기 부하를 확인하세요.`,
  };
};

const setPowerCap: Handler = (ctx, args) => {
  const target = need(args, "server");
  const watts = args.watts === undefined ? null : Number(args.watts);
  ctx.world.apply({ type: "power.cap", target, watts }, "tool:set_power_cap");
  return {
    server: target,
    capW: watts,
    note:
      watts === null
        ? "캡을 풀었어요."
        : "캡을 걸었어요. 서버는 유휴 전력 아래로는 내려가지 않아요. power_cap_status로 처리량과 랙 전력을 확인하세요.",
  };
};

function capRow(world: WorldPort, server: Entity) {
  const s = world.stateAs(server.id, "server");
  const model = world.catalog.getOf(server.modelId ?? "", "server");
  return {
    id: server.id,
    powerW: Math.round(s.powerW),
    capW: s.powerCapW ?? null,
    idleW: model.idlePowerW,
    maxW: model.maxPowerW,
    cpuC: r1(s.cpuC),
    throttled: s.throttled,
    perf: s.perf === undefined ? 1 : Math.round(s.perf * 100) / 100,
    running: s.powered && s.adminOn,
  };
}

const powerCapStatus: Handler = (ctx, args) => {
  const { world } = ctx;
  const only = opt(args, "rack");
  const racks = [...world.index.ofKind("rack")]
    .filter((r) => (only ? r.id === only : typeof r.props.powerLimitW === "number"))
    .sort(byId);
  if (racks.length === 0) throw new InvalidValueError("전력 한도가 있는 랙이 이 세계에 없어요");
  return {
    racks: racks.map((r) => {
      const s = world.stateAs(r.id, "rack");
      return {
        id: r.id,
        limitW: r.props.powerLimitW ?? null,
        powerW: Math.round(s.powerW),
        inletC: r1(s.inletC),
        secondsOverLimit: Math.round(s.overS ?? 0),
        timesOverLimit: s.overCount ?? 0,
        workLostToCapsServerSeconds: Math.round(s.lossS ?? 0),
        servers: world.index.childrenOf(r.id, "server").map((sv) => capRow(world, sv)),
      };
    }),
  };
};

function cduRow(world: WorldPort, e: Entity) {
  const s = world.stateAs(e.id, "cdu");
  const racks = world.index.incoming(e.id, "cooling").map((l) => l.from);
  const leak = [e.id, ...racks].some((id) =>
    world.faultsOn(id).some((f) => f.type === "coolant_leak"),
  );
  return {
    id: e.id,
    name: e.name,
    running: s.running,
    supplyC: r1(s.supplyC),
    returnC: r1(s.returnC),
    loadKw: r1(s.loadKw),
    capacityKw: r1(s.capacityKw),
    pumps: s.pumpsOk.map((ok, i) => ({
      pump: i + 1,
      ok,
      role: i < s.pumpsOk.length - 1 ? "duty" : "standby",
    })),
    manualStandby: e.props.manualStandby === true,
    standbyOn: s.standbyOn === true,
    leakSensor: leak ? "tripped" : "dry",
    racks,
  };
}

const cduStatus: Handler = (ctx, args) => {
  const { world } = ctx;
  const only = opt(args, "cdu");
  const cdus = [...world.index.ofKind("cdu")].filter((e) => !only || e.id === only).sort(byId);
  if (cdus.length === 0) throw new InvalidValueError("이 세계에는 CDU가 없어요");
  return { cdus: cdus.map((e) => cduRow(world, e)) };
};

const coolingStatus: Handler = (ctx, args) => {
  const { world } = ctx;
  const only = opt(args, "id");
  const pick = (kind: Parameters<typeof world.index.ofKind>[0]) =>
    [...world.index.ofKind(kind)].filter((e) => !only || e.id === only).sort(byId);
  return {
    crah: pick("cooling_unit").map((e) => {
      const s = world.stateAs(e.id, "cooling_unit");
      return {
        id: e.id,
        running: s.running,
        supplyC: r1(s.supplyC),
        returnC: r1(s.returnC),
        loadKw: r1(s.loadKw),
        capacityKw: r1(s.capacityKw),
      };
    }),
    cdus: pick("cdu").map((e) => cduRow(world, e)),
    rearDoors: pick("rdhx").map((e) => {
      const s = world.stateAs(e.id, "rdhx");
      return {
        id: e.id,
        status: s.status,
        ...(s.why ? { why: s.why } : {}),
        valvePct: s.valvePct,
        waterInC: s.waterInC,
        waterOutC: s.waterOutC,
      };
    }),
    tanks: pick("immersion_tank").map((e) => {
      const s = world.stateAs(e.id, "immersion_tank");
      return {
        id: e.id,
        status: s.status,
        ...(s.why ? { why: s.why } : {}),
        fluidC: s.fluidC,
        pumpOk: s.pumpOk,
        levelPct: s.levelPct,
      };
    }),
    plants: pick("chiller").map((e) => {
      const s = world.stateAs(e.id, "chiller");
      return {
        id: e.id,
        running: s.running,
        supplyC: r1(s.supplyC),
        loadKw: r1(s.loadKw),
        capacityKw: r1(s.capacityKw),
      };
    }),
  };
};

const cduPumpSwitch: Handler = (ctx, args) => {
  const target = need(args, "cdu");
  ctx.world.apply({ type: "cdu.pump_switch", target }, "tool:cdu_pump_switch");
  return {
    cdu: target,
    note: "예비 펌프를 돌렸어요. cdu_status로 유량(용량)이 돌아왔는지 확인하세요.",
  };
};

export const ACCEL_HANDLERS: Readonly<Record<string, Handler>> = {
  gpu_status: gpuStatus,
  gpu_reset: gpuReset,
  ib_status: ibStatus,
  job_status: jobStatus,
  job_resume: jobResume,
  node_drain: nodeDrain,
  pool_scale: poolScale,
  power_status: powerStatus,
  bbu_status: bbuStatus,
  substation_status: substationStatus,
  transfer_feed: transferFeed,
  set_power_cap: setPowerCap,
  power_cap_status: powerCapStatus,
  cooling_status: coolingStatus,
  cdu_status: cduStatus,
  cdu_pump_switch: cduPumpSwitch,
};
