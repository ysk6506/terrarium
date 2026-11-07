/**
 * What an operator does to the application layer (REQ-100, ADR-0121): take a backend out of the load balancer and put it
 * back, reset a circuit breaker, roll the mesh configuration back, send all traffic to one region. They are world events
 * and change state only through the reducers here. The load balancer, the breakers and the global balancer move by
 * themselves too (physics/app.ts, cause `cluster`).
 */
import { ConflictError, InvalidValueError } from "@terrarium/core/kernel";
import { RELOGIN_S, regionsOf, SIDECAR_PROCESS } from "./app";
import type { WorldReader } from "./world";

export type AppCommand =
  /** A backend leaves the rotation and stays out whatever its health checks say. */
  | { readonly type: "lb.drain"; readonly target: string }
  /** A drained backend is under the balancer's health checks again. */
  | { readonly type: "lb.enable"; readonly target: string }
  /** A circuit breaker is closed again by hand (a fault that holds it open ends). */
  | { readonly type: "circuit.reset"; readonly target: string }
  /** The mesh goes back to its previous configuration. */
  | { readonly type: "mesh.rollback"; readonly target: string }
  /** All traffic goes to this region; the global balancer no longer moves it by itself. */
  | { readonly type: "region.failover"; readonly target: string };

export const isAppCommand = (type: string): boolean =>
  type === "lb.drain" ||
  type === "lb.enable" ||
  type === "circuit.reset" ||
  type === "mesh.rollback" ||
  type === "region.failover";

function entityOf(world: WorldReader, id: string, kind: string, words: string) {
  const e = world.index.entity(id);
  if (e.kind !== kind) throw new InvalidValueError(`'${id}'는 ${words}이 아니에요`);
  return e;
}

function checkBackend(world: WorldReader, command: AppCommand): void {
  entityOf(world, command.target, "app_instance", "애플리케이션 인스턴스");
  const s = world.stateAs(command.target, "app_instance");
  if (command.type === "lb.drain" && s.drained)
    throw new ConflictError(`'${command.target}'는 이미 로테이션에서 빠져 있어요`);
  if (command.type === "lb.enable" && !s.drained)
    throw new ConflictError(`'${command.target}'는 빠져 있지 않아요(drain한 적이 없어요)`);
}

function checkMesh(world: WorldReader, target: string): void {
  entityOf(world, target, "mesh_control", "메시 컨트롤 플레인");
  const s = world.stateAs(target, "mesh_control");
  if (s.status === "down")
    throw new ConflictError(
      `'${target}'가 멈춰 있어서 설정을 되돌릴 수 없어요(istiod를 먼저 다시 시작하세요)`,
    );
  if (s.retries === "sane")
    throw new ConflictError(`'${target}'는 되돌릴 새 설정이 없어요(지금 설정이 처음 그대로예요)`);
}

function checkRegion(world: WorldReader, target: string): void {
  entityOf(world, target, "region", "리전");
  const s = world.stateAs(target, "region");
  if (s.status === "down")
    throw new ConflictError(`'${target}'는 멈춰 있어서 트래픽을 받을 수 없어요`);
  const pinned = world.index
    .ofKind("load_balancer")
    .filter((l) => regionsOf(world.index, l.id).some((r) => r.id === target));
  if (pinned.length === 0) throw new ConflictError(`'${target}' 앞에 글로벌 로드 밸런서가 없어요`);
  if (pinned.every((l) => world.stateAs(l.id, "load_balancer").pinned === target))
    throw new ConflictError(`트래픽이 이미 '${target}'로만 가고 있어요`);
}

function checkBreaker(world: WorldReader, target: string): void {
  entityOf(world, target, "circuit_breaker", "서킷 브레이커");
  const s = world.stateAs(target, "circuit_breaker");
  if (s.mode === "closed" && !s.stuck) throw new ConflictError(`'${target}'는 이미 닫혀 있어요`);
}

/** Refuse commands that make no sense before they are recorded. */
export function checkAppCommand(world: WorldReader, command: AppCommand): void {
  if (command.type === "lb.drain" || command.type === "lb.enable") checkBackend(world, command);
  else if (command.type === "circuit.reset") checkBreaker(world, command.target);
  else if (command.type === "mesh.rollback") checkMesh(world, command.target);
  else checkRegion(world, command.target);
}

/** What the reducers read of the world beyond reading it. */
export interface AppActContext {
  readonly world: WorldReader;
  readonly t: number;
  dropFault(faultId: string): void;
}

function dropFaults(ctx: AppActContext, target: string, types: readonly string[]): void {
  for (const f of ctx.world.faultsOn(target)) if (types.includes(f.type)) ctx.dropFault(f.id);
}

export function drainBackend(ctx: AppActContext, target: string): void {
  const s = ctx.world.stateAs(target, "app_instance");
  s.drained = true;
  s.inRotation = false;
}

export function enableBackend(ctx: AppActContext, target: string): void {
  const s = ctx.world.stateAs(target, "app_instance");
  s.drained = false;
  delete s.badSince;
  delete s.goodSince;
}

export function resetBreaker(ctx: AppActContext, target: string): void {
  dropFaults(ctx, target, ["circuit_breaker_stuck_open"]);
  const s = ctx.world.stateAs(target, "circuit_breaker");
  s.mode = "closed";
  s.stuck = false;
  delete s.failingSince;
  delete s.openedAt;
}

export function rollbackMesh(ctx: AppActContext, target: string): void {
  dropFaults(ctx, target, ["retry_storm"]);
  const s = ctx.world.stateAs(target, "mesh_control");
  s.retries = "sane";
  s.revision = s.previous;
}

/** All traffic goes to one region; the users of the region it leaves log in again. */
export function failoverRegion(ctx: AppActContext, target: string): void {
  for (const lb of ctx.world.index.ofKind("load_balancer")) {
    const regions = regionsOf(ctx.world.index, lb.id);
    if (!regions.some((r) => r.id === target)) continue;
    const s = ctx.world.stateAs(lb.id, "load_balancer");
    const left = s.rotation.filter((id) => id !== target);
    s.pinned = target;
    s.rotation = [target];
    if (left.length > 0) s.reloginUntil = ctx.t + RELOGIN_S;
  }
}

/** Restarting the session store, a sidecar or the mesh control plane ends the fault a restart can end. */
export function restartAppProcess(ctx: AppActContext, hostId: string, unit: string): void {
  const kinds: Record<string, [string, string]> = {
    "redis-server": ["session_store", "session_store_down"],
    [SIDECAR_PROCESS]: ["mesh_sidecar", "sidecar_crash"],
    istiod: ["mesh_control", "mesh_control_down"],
  };
  const hit = kinds[unit];
  if (!hit) return;
  const [kind, fault] = hit;
  const near = (id: string): boolean => hostOnHost(ctx.world, id) === hostId;
  for (const e of ctx.world.index.ofKind(kind as "session_store"))
    if (near(e.id)) dropFaults(ctx, e.id, [fault]);
}

/** The VM or server an entity of the application layer stands on (a sidecar: the host of its instance). */
function hostOnHost(world: WorldReader, id: string): string | undefined {
  const to = world.index.outgoing(id, "hosted_on")[0]?.to;
  return to && world.index.find(to)?.kind === "app_instance" ? hostOnHost(world, to) : to;
}
