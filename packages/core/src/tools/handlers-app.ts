/**
 * The handlers of the application-layer tools (REQ-100): they read the state the physics keeps and give a command to the
 * world. The status tools say what the balancer, breaker or mesh would show an operator; the actions say plainly what
 * happens next (a drained backend gets no requests, a rolled-back mesh stops the retries).
 */
import { InvalidValueError } from "@terrarium/core/kernel";
import {
  appInstancesOf,
  breakerDef,
  breakerEnds,
  breakerOfLink,
  breakers,
  callDef,
  type Entity,
  hostOfApp,
  LB_FAIL_CHECKS,
  lbOf,
  loadBalancerDef,
  meshControls,
  regionOf,
  regionsOf,
  servicesBehind,
  type WorldPort,
} from "@terrarium/core/world";
import type { Args, ToolContext } from "./handlers";

type Handler = (ctx: ToolContext, args: Args) => unknown;

const opt = (args: Args, key: string): string | undefined =>
  args[key] === undefined || args[key] === "" ? undefined : String(args[key]);
const need = (args: Args, key: string): string => String(args[key] ?? "");

function backendRow(world: WorldPort, e: Entity, intervalS: number) {
  const s = world.stateAs(e.id, "app_instance");
  const host = hostOfApp(world.index, e.id);
  const region = regionOf(world.index, e.id);
  return {
    id: e.id,
    name: e.name,
    ...(host ? { host } : {}),
    ...(region ? { region: region.id } : {}),
    status: s.status,
    ...(s.why ? { why: s.why } : {}),
    inRotation: s.inRotation,
    drained: s.drained,
    ...(s.flapping ? { flapping: true } : {}),
    ...(s.badSince !== undefined && s.inRotation
      ? {
          autoRemoveInSeconds: Math.max(
            0,
            Math.round(LB_FAIL_CHECKS * intervalS - (world.time() - s.badSince)),
          ),
        }
      : {}),
  };
}

function balancerRow(world: WorldPort, lb: Entity) {
  const s = world.stateAs(lb.id, "load_balancer");
  const def = loadBalancerDef(lb);
  const services = servicesBehind(world.index, lb.id);
  const backends = services.flatMap((svc) => appInstancesOf(world.index, svc.id));
  return {
    id: lb.id,
    name: lb.name,
    scope: def.global ? "global" : "service",
    status: s.status,
    ...(s.why ? { why: s.why } : {}),
    healthCheckIntervalSeconds: def.intervalS,
    services: services.map((x) => x.id),
    backends: backends.map((b) => backendRow(world, b, def.intervalS)),
    ...(def.global
      ? {
          rotation: s.rotation,
          regions: regionsOf(world.index, lb.id).map((r) => {
            const rs = world.stateAs(r.id, "region");
            return { id: r.id, status: rs.status, replicationLagSeconds: Math.round(rs.lagS) };
          }),
          ...(s.pinned ? { pinnedTo: s.pinned } : {}),
          detectSeconds: def.detectS,
        }
      : {}),
  };
}

const lbStatus: Handler = (ctx, args) => {
  const { world } = ctx;
  const only = opt(args, "service");
  const all = [...world.index.ofKind("load_balancer")].sort((a, b) => a.id.localeCompare(b.id));
  if (all.length === 0) throw new InvalidValueError("이 세계에는 로드 밸런서가 없어요");
  if (only) {
    if (world.index.find(only)?.kind !== "service")
      throw new InvalidValueError(`'${only}'는 서비스가 아니에요`);
    const lb = lbOf(world.index, only);
    if (!lb) throw new InvalidValueError(`'${only}' 앞에는 로드 밸런서가 없어요`);
    return { balancers: [balancerRow(world, lb)] };
  }
  return { balancers: all.map((lb) => balancerRow(world, lb)) };
};

const lbDrain: Handler = (ctx, args) => {
  const target = need(args, "backend");
  ctx.world.apply({ type: "lb.drain", target }, "tool:lb_drain");
  return {
    backend: target,
    drained: true,
    note: "이 백엔드로는 요청이 가지 않아요. 고장은 그대로예요. 고친 뒤 lb_enable로 되돌리세요.",
  };
};

const lbEnable: Handler = (ctx, args) => {
  const target = need(args, "backend");
  ctx.world.apply({ type: "lb.enable", target }, "tool:lb_enable");
  return {
    backend: target,
    drained: false,
    note: "헬스 체크가 2번 통과하면 로테이션에 다시 들어가요. lb_status로 확인하세요.",
  };
};

// ── breakers ───────────────────────────────────────────────────────────────────────────────

function breakerRow(world: WorldPort, b: Entity) {
  const s = world.stateAs(b.id, "circuit_breaker");
  const def = breakerDef(b);
  const ends = breakerEnds(world.index, b);
  const link = world.index.allLinks().find((l) => l.id === def.link);
  const call = link ? callDef(link) : undefined;
  const name = (id: string | undefined) => (id ? (world.index.find(id)?.name ?? id) : undefined);
  return {
    id: b.id,
    link: def.link,
    caller: ends?.from,
    callee: ends?.to,
    callerName: name(ends?.from),
    calleeName: name(ends?.to),
    mode: s.mode,
    trips: s.trips,
    stuck: s.stuck,
    ...(s.why ? { why: s.why } : {}),
    opensAfterFailures: def.failures,
    resetSeconds: def.resetS,
    ...(call ? { critical: call.critical, fanout: call.fanout, timeoutMs: call.timeoutMs } : {}),
    ...(s.openedAt !== undefined && s.mode === "open"
      ? { halfOpenInSeconds: Math.max(0, Math.round(def.resetS - (world.time() - s.openedAt))) }
      : {}),
  };
}

const breakerStatus: Handler = (ctx, args) => {
  const { world } = ctx;
  const only = opt(args, "service");
  const list = breakers(world.index).filter((b) => {
    if (!only) return true;
    const ends = breakerEnds(world.index, b);
    return ends?.from === only || ends?.to === only;
  });
  if (world.index.ofKind("circuit_breaker").length === 0)
    throw new InvalidValueError("이 세계에는 서킷 브레이커가 없어요");
  return { breakers: list.map((b) => breakerRow(world, b)) };
};

const breakerReset: Handler = (ctx, args) => {
  const { world } = ctx;
  const id = need(args, "link");
  const found =
    world.index.find(id)?.kind === "circuit_breaker"
      ? world.index.entity(id)
      : breakerOfLink(world.index, id);
  if (!found) throw new InvalidValueError(`'${id}'에는 서킷 브레이커가 없어요`);
  world.apply({ type: "circuit.reset", target: found.id }, "tool:breaker_reset");
  return {
    breaker: found.id,
    mode: world.stateAs(found.id, "circuit_breaker").mode,
    note: "닫았어요. 상대가 아직 멈춰 있으면 실패가 이어져 다시 열려요. breaker_status로 확인하세요.",
  };
};

// ── mesh and regions ───────────────────────────────────────────────────────────────────────

const meshStatus: Handler = (ctx, args) => {
  const { world } = ctx;
  const only = opt(args, "instance");
  const controls = meshControls(world.index);
  if (controls.length === 0) throw new InvalidValueError("이 세계에는 서비스 메시가 없어요");
  return {
    controls: controls.map((c) => {
      const s = world.stateAs(c.id, "mesh_control");
      return {
        id: c.id,
        name: c.name,
        status: s.status,
        ...(s.why ? { why: s.why } : {}),
        revision: s.revision,
        retries: s.retries,
        headless: s.status === "down",
        canRollback: s.status === "ok" && s.retries === "aggressive",
      };
    }),
    sidecars: [...world.index.ofKind("mesh_sidecar")]
      .filter((e) => !only || world.index.outgoing(e.id, "hosted_on")[0]?.to === only)
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((e) => {
        const s = world.stateAs(e.id, "mesh_sidecar");
        const instance = world.index.outgoing(e.id, "hosted_on")[0]?.to;
        return {
          id: e.id,
          instance,
          host: hostOfApp(world.index, e.id),
          status: s.status,
          ...(s.why ? { why: s.why } : {}),
          mtls: s.mtls,
          revision: s.revision,
        };
      }),
  };
};

const meshRollback: Handler = (ctx, args) => {
  const { world } = ctx;
  const named = opt(args, "control");
  const controls = meshControls(world.index);
  const target = named ?? controls[0]?.id;
  if (!target) throw new InvalidValueError("이 세계에는 서비스 메시가 없어요");
  world.apply({ type: "mesh.rollback", target }, "tool:mesh_rollback");
  return {
    control: target,
    revision: world.stateAs(target, "mesh_control").revision,
    note: "이전 설정으로 되돌렸어요. 재시도가 멈추고 호출이 정상으로 돌아와요. mesh_status로 확인하세요.",
  };
};

const regionFailover: Handler = (ctx, args) => {
  const { world } = ctx;
  const region = need(args, "region");
  if (world.index.find(region)?.kind !== "region") {
    const all = world.index.ofKind("region").map((r) => r.id);
    throw new InvalidValueError(
      `'${region}'는 리전이 아니에요${all.length > 0 ? ` (${all.join(", ")})` : ""}`,
    );
  }
  world.apply({ type: "region.failover", target: region }, "tool:region_failover");
  return {
    region,
    note: "모든 트래픽을 이 리전으로 보냈어요. 빠진 리전의 세션은 사라져 사용자가 다시 로그인해요. 멈춘 리전은 클라우드 팀이 살려요(escalate).",
  };
};

export const APP_HANDLERS: Readonly<Record<string, Handler>> = {
  lb_status: lbStatus,
  lb_drain: lbDrain,
  lb_enable: lbEnable,
  breaker_status: breakerStatus,
  breaker_reset: breakerReset,
  mesh_status: meshStatus,
  mesh_rollback: meshRollback,
  region_failover: regionFailover,
};
