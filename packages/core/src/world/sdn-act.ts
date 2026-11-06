/**
 * What an operator does to the overlay and the cloud-native layer (REQ-097): push the controller's configuration to
 * a switch again, make the standby controller the active one, put a network policy's rule back (or set it, which is
 * how a scenario makes the mistake of a wrong policy), restart an ingress controller. They are world events and change
 * state only through the reducers here. The standby takes over by itself (cause `cluster`) with `sdn.failover`.
 */
import { ConflictError, InvalidValueError } from "@terrarium/core/kernel";
import { INGRESS_RESTART_S, type PolicyRule, sdnControllers, vtepOfSwitch } from "./sdn";
import type { WorldReader } from "./world";

export type SdnCommand =
  /** Push the controller's configuration to a switch's VTEP again (and reset its EVPN session). */
  | { readonly type: "sdn.sync"; readonly target: string }
  /** This controller becomes the active one; the new active pushes the whole configuration again. */
  | { readonly type: "sdn.failover"; readonly target: string }
  /** A network policy is deployed with this rule. */
  | { readonly type: "policy.set"; readonly target: string; readonly rule: PolicyRule }
  /** A network policy goes back to the rule it had before the last change. */
  | { readonly type: "policy.revert"; readonly target: string }
  /** An ingress controller is restarted. */
  | { readonly type: "ingress.restart"; readonly target: string };

export const isSdnCommand = (type: string): boolean =>
  type === "sdn.sync" ||
  type === "sdn.failover" ||
  type === "policy.set" ||
  type === "policy.revert" ||
  type === "ingress.restart";

/** The VTEP a switch (or the VTEP itself) names. */
export function vtepFor(world: WorldReader, target: string): string {
  const e = world.index.entity(target);
  if (e.kind === "vtep") return e.id;
  const v = e.kind === "switch" ? vtepOfSwitch(world.index, e.id) : undefined;
  if (!v)
    throw new InvalidValueError(
      `'${target}'에는 VTEP이 없어요 (오버레이에 들어 있지 않은 스위치예요)`,
    );
  return v.id;
}

/** The active controller, if one is up. */
export function activeController(world: WorldReader): string | undefined {
  return sdnControllers(world.index).find((c) => {
    const s = world.stateAs(c.id, "sdn_controller");
    return s.role === "active" && s.status === "ok";
  })?.id;
}

function checkSync(world: WorldReader, target: string): void {
  vtepFor(world, target);
  if (!activeController(world))
    throw new ConflictError(
      "컨트롤러가 멈춰 있어서 설정을 밀 수 없어요(헤드리스: 이미 깔린 흐름만 돌아요)",
    );
}

function checkFailover(world: WorldReader, target: string): void {
  const e = world.index.entity(target);
  if (e.kind !== "sdn_controller")
    throw new InvalidValueError(`'${target}'는 SDN 컨트롤러가 아니에요`);
  const s = world.stateAs(target, "sdn_controller");
  if (s.role === "active") throw new ConflictError(`'${target}'는 이미 액티브예요`);
  if (s.status === "down")
    throw new InvalidValueError(`'${target}'가 멈춰 있어서 넘겨받을 수 없어요`);
}

function checkPolicy(world: WorldReader, command: SdnCommand): void {
  const e = world.index.entity(command.target);
  if (e.kind !== "network_policy")
    throw new InvalidValueError(`'${e.id}'는 네트워크 정책이 아니에요`);
  const s = world.stateAs(e.id, "network_policy");
  if (command.type === "policy.set" && s.rule === command.rule)
    throw new ConflictError(`'${e.id}'는 이미 ${command.rule}예요`);
  if (command.type === "policy.revert" && s.previous === s.rule)
    throw new ConflictError(`'${e.id}'는 되돌릴 이전 설정이 없어요(처음부터 지금 설정이에요)`);
}

function checkIngress(world: WorldReader, target: string): void {
  const e = world.index.entity(target);
  if (e.kind !== "ingress") throw new InvalidValueError(`'${target}'는 인그레스가 아니에요`);
  const s = world.stateAs(target, "ingress");
  if (s.upAt !== undefined && world.time() < s.upAt)
    throw new ConflictError(`'${target}'는 이미 다시 뜨는 중이에요`);
}

/** Refuse commands that make no sense before they are recorded. */
export function checkSdnCommand(world: WorldReader, command: SdnCommand): void {
  if (command.type === "sdn.sync") checkSync(world, command.target);
  else if (command.type === "sdn.failover") checkFailover(world, command.target);
  else if (command.type === "ingress.restart") checkIngress(world, command.target);
  else checkPolicy(world, command);
}

/** What the reducers read of the world beyond reading it. */
export interface SdnActContext {
  readonly world: WorldReader;
  readonly t: number;
  dropFault(faultId: string): void;
}

function dropFaults(ctx: SdnActContext, target: string, types: readonly string[]): void {
  for (const f of ctx.world.faultsOn(target)) if (types.includes(f.type)) ctx.dropFault(f.id);
}

/** The configuration is pushed again and the session reset: a stale VTEP is current, a flapping session settles. */
export function syncSwitch(ctx: SdnActContext, target: string): void {
  const id = vtepFor(ctx.world, target);
  dropFaults(ctx, id, ["sdn_sync_failed", "evpn_session_flap"]);
  const v = ctx.world.stateAs(id, "vtep");
  v.revision = ctx.world.stateAs(activeController(ctx.world) as string, "sdn_controller").revision;
  if (v.evpn === "down") v.evpnUpAt = ctx.t + 10;
  v.byOperator = true;
}

/** This controller is active from now on; the new active pushes everything, which ends every failed sync. */
export function takeOver(ctx: SdnActContext, target: string): void {
  for (const c of sdnControllers(ctx.world.index)) {
    const s = ctx.world.stateAs(c.id, "sdn_controller");
    s.role = c.id === target ? "active" : "standby";
    delete s.downSince;
  }
  for (const v of ctx.world.index.ofKind("vtep")) {
    dropFaults(ctx, v.id, ["sdn_sync_failed"]);
    ctx.world.stateAs(v.id, "vtep").revision = ctx.world.stateAs(target, "sdn_controller").revision;
  }
}

export function setPolicy(ctx: SdnActContext, target: string, rule: PolicyRule): void {
  const s = ctx.world.stateAs(target, "network_policy");
  s.previous = s.rule;
  s.rule = rule;
  s.changedAt = ctx.t;
}

export function revertPolicy(ctx: SdnActContext, target: string): void {
  const s = ctx.world.stateAs(target, "network_policy");
  [s.rule, s.previous] = [s.previous, s.rule];
  s.changedAt = ctx.t;
}

export function restartIngress(ctx: SdnActContext, target: string): void {
  dropFaults(ctx, target, ["ingress_controller_down"]);
  ctx.world.stateAs(target, "ingress").upAt = ctx.t + INGRESS_RESTART_S;
}

/** Restarting the CNI plugin on a node ends its failure. */
export function restartCni(ctx: SdnActContext, hostId: string): void {
  for (const l of ctx.world.index.incoming(hostId, "hosted_on"))
    dropFaults(ctx, l.from, ["cni_plugin_failure"]);
}

/** Restarting the ingress controller's process on a node ends its failure too. */
export function restartIngressProcess(ctx: SdnActContext, hostId: string): void {
  for (const l of ctx.world.index.incoming(hostId, "hosted_on"))
    if (ctx.world.index.find(l.from)?.kind === "ingress") restartIngress(ctx, l.from);
}
