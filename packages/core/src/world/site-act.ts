/**
 * What an operator does to the site and DR layer, the geo volumes, the consensus ring and the managed database
 * (REQ-106, ADR-0129): move the services to the other site and back, run a dry run of the move, promote a volume's
 * copy, restart or lead a node, switch a managed database's zone, grow its storage. They are world events and change
 * state only through the reducers here. Hot and active sites give `dr.failover` by themselves (cause `cluster`), and
 * physics gives `dr.complete` when a move has taken its time.
 */
import { ConflictError, InvalidValueError } from "@terrarium/core/kernel";
import type { ServiceActContext } from "./service-act";
import { failover } from "./service-act";
import {
  azNames,
  drPlanDef,
  FAILBACK_S,
  majority,
  REPLICATOR_PROCESS,
  ringOf,
  serversOfSite,
  siteOf,
  streamDef,
  streamsOfPlan,
} from "./site-dr";
import { drillOf, effectiveRtoS, protectedServices, ringDown, volumesOfPlan } from "./site-model";
import type { WorldReader } from "./world";

export type SiteCommand =
  /** Move the services to this site (the one that is kept, when both thought they led). */
  | {
      readonly type: "dr.failover";
      readonly target: string;
      readonly site: string;
      /** The plan moved by itself (a hot or active site that saw the primary gone). */
      readonly auto?: boolean;
    }
  /** Move the services back to the primary site once it is well. */
  | { readonly type: "dr.failback"; readonly target: string }
  /** A dry run: what the move would take and lose now. Changes nothing but the note of the last drill. */
  | { readonly type: "dr.drill"; readonly target: string }
  /** A move has taken its time: the services run at the other site now. Given by physics. */
  | { readonly type: "dr.complete"; readonly target: string }
  /** Make this site's copy of the volume the writable one. */
  | { readonly type: "volume.promote"; readonly target: string; readonly site: string }
  /** Restart a node of the consensus ring. */
  | { readonly type: "dbnode.restart"; readonly target: string }
  /** Hand the lead to this node. */
  | { readonly type: "dbnode.transfer"; readonly target: string }
  /** Switch the managed database to this availability zone (1 is the first). */
  | { readonly type: "dbm.failover"; readonly target: string; readonly az: number }
  /** Grow the managed database's storage now. */
  | { readonly type: "dbm.scale"; readonly target: string };

const TYPES = new Set([
  "dr.failover",
  "dr.failback",
  "dr.drill",
  "dr.complete",
  "volume.promote",
  "dbnode.restart",
  "dbnode.transfer",
  "dbm.failover",
  "dbm.scale",
]);
export const isSiteCommand = (type: string): boolean => TYPES.has(type);

/** Seconds a stuck failover needs once an operator pushes it on. */
export const RESUME_S = 120;

function kindOf(world: WorldReader, id: string, kind: string, words: string) {
  const e = world.index.entity(id);
  if (e.kind !== kind) throw new InvalidValueError(`'${id}'는 ${words}이 아니에요`);
  return e;
}

const faultOn = (world: WorldReader, id: string, type: string) =>
  world.faultsOn(id).find((f) => f.type === type);

function checkFailover(world: WorldReader, target: string, site: string): void {
  const plan = kindOf(world, target, "dr_plan", "DR 계획");
  const def = drPlanDef(plan);
  if (site !== def.primary && site !== def.dr)
    throw new InvalidValueError(
      `'${site}'는 이 DR 계획의 사이트가 아니에요 (${def.primary}, ${def.dr})`,
    );
  const s = world.stateAs(target, "dr_plan");
  if (faultOn(world, target, "split_brain") && drPlanEffectiveSplit(world, target)) return;
  if (s.phase === "stuck") return;
  if (s.phase !== "idle") throw new ConflictError("이미 전환하고 있어요");
  if (def.mode === "active")
    throw new ConflictError(
      "두 사이트가 모두 일하고 있어서 전환할 게 없어요(죽은 사이트는 로드 밸런서가 알아서 빼요)",
    );
  if (s.serving === site) throw new ConflictError(`서비스가 이미 '${site}'에서 돌고 있어요`);
  if (world.stateAs(site, "dr_site").status === "down")
    throw new ConflictError(`'${site}'는 전기가 없거나 서버가 모두 멈춰 있어서 받을 수 없어요`);
}

const drPlanEffectiveSplit = (world: WorldReader, plan: string): boolean =>
  world.stateAs(plan, "dr_plan").split;

function checkFailback(world: WorldReader, target: string): void {
  const plan = kindOf(world, target, "dr_plan", "DR 계획");
  const def = drPlanDef(plan);
  const s = world.stateAs(target, "dr_plan");
  if (s.phase !== "idle") throw new ConflictError("이미 전환하고 있어요");
  if (s.serving === def.primary) throw new ConflictError("서비스가 이미 본 사이트에서 돌고 있어요");
  if (world.stateAs(def.primary, "dr_site").status !== "ok")
    throw new ConflictError("본 사이트가 아직 온전하지 않아서 돌아갈 수 없어요");
  if (world.stateAs(world.index.ofKind("site_link")[0]?.id ?? "", "site_link").status === "down")
    throw new ConflictError("사이트 간 회선이 끊겨 있어서 데이터를 되돌릴 수 없어요");
}

function checkVolume(world: WorldReader, target: string, site: string): void {
  const vol = kindOf(world, target, "volume", "볼륨");
  const replica = String(vol.props.replicaSite ?? "");
  const s = world.stateAs(target, "volume");
  if (site !== replica && site !== s.primary)
    throw new InvalidValueError(`'${site}'에는 이 볼륨의 복사본이 없어요`);
  if (s.primary === site) throw new ConflictError(`'${site}'가 이미 이 볼륨의 주인이에요`);
  if (faultOn(world, target, "geo_replica_broken"))
    throw new ConflictError(
      "복사본이 깨져 있어서 올릴 수 없어요(스토리지 팀이 다시 만들어야 해요)",
    );
  if (world.stateAs(site, "dr_site").status === "down")
    throw new ConflictError(`'${site}'가 멈춰 있어서 볼륨을 올릴 수 없어요`);
}

function checkNode(world: WorldReader, command: SiteCommand & { target: string }): void {
  kindOf(world, command.target, "db_node", "합의 DB 노드");
  const s = world.stateAs(command.target, "db_node");
  if (command.type === "dbnode.restart" && s.status === "ok")
    throw new ConflictError(`'${command.target}'는 이미 정상이에요`);
  if (command.type !== "dbnode.transfer") return;
  const owner = world.index.incoming(command.target, "depends_on")[0]?.from;
  const ring = owner ? ringOf(world.index, owner) : [];
  const alive = ring.filter((n) => world.stateAs(n.id, "db_node").status !== "down").length;
  if (s.status === "down") throw new ConflictError("멈춘 노드에는 리더를 넘길 수 없어요");
  if (s.status === "lagging") throw new ConflictError("뒤처진 노드는 리더가 될 수 없어요");
  if (alive < majority(ring.length)) throw new ConflictError("과반이 없어서 리더를 옮길 수 없어요");
  if (s.role === "leader") throw new ConflictError(`'${command.target}'가 이미 리더예요`);
}

function checkPick(world: WorldReader, target: string, az: number, names: readonly string[]): void {
  const s = world.stateAs(target, "db_managed");
  if (!Number.isInteger(az) || az < 1 || az > names.length)
    throw new InvalidValueError(`영역은 1~${names.length}번 중에 골라요 (${names.join(", ")})`);
  const down = faultOn(world, target, "db_az_failure");
  if (down && (down.params.az ?? 1) === az)
    throw new ConflictError(`${names[az - 1]}은 멈춰 있어서 받을 수 없어요`);
  if (s.activeAz === az - 1 && s.pinned)
    throw new ConflictError(`${names[az - 1]}이 이미 주인이에요`);
}

function checkManaged(world: WorldReader, command: SiteCommand & { target: string }): void {
  const e = kindOf(world, command.target, "db_managed", "관리형 DB");
  if (command.type === "dbm.scale") {
    if (
      world.stateAs(command.target, "db_managed").storageUsedPct < 80 &&
      !faultOn(world, command.target, "db_storage_full")
    )
      throw new ConflictError("저장소에 여유가 있어서 늘릴 필요가 없어요");
  } else if (command.type === "dbm.failover")
    checkPick(world, command.target, command.az, azNames(e));
}

/** Refuse commands that make no sense before they are recorded. */
export function checkSiteCommand(world: WorldReader, command: SiteCommand): void {
  switch (command.type) {
    case "dr.failover":
      checkFailover(world, command.target, command.site);
      return;
    case "dr.failback":
      checkFailback(world, command.target);
      return;
    case "dr.drill":
      kindOf(world, command.target, "dr_plan", "DR 계획");
      if (world.stateAs(command.target, "dr_plan").phase !== "idle")
        throw new ConflictError("전환하는 중에는 모의 훈련을 할 수 없어요");
      return;
    case "dr.complete":
      kindOf(world, command.target, "dr_plan", "DR 계획");
      return;
    case "volume.promote":
      checkVolume(world, command.target, command.site);
      return;
    case "dbnode.restart":
    case "dbnode.transfer":
      checkNode(world, command);
      return;
    case "dbm.failover":
    case "dbm.scale":
      checkManaged(world, command);
      return;
  }
}

/** What the reducers read of the world beyond reading it. */
export interface SiteActContext {
  readonly world: WorldReader;
  readonly t: number;
  dropFault(faultId: string): void;
  service(): ServiceActContext;
}

// ── sites ──────────────────────────────────────────────────────────────────────────────────

function powerOn(ctx: SiteActContext, siteId: string): void {
  for (const id of serversOfSite(ctx.world.index, siteId))
    ctx.world.stateAs(id, "server").adminOn = true;
}

/** Both sites led: the kept one wins, the other's writes since the cut are thrown away. */
function resolveSplit(ctx: SiteActContext, plan: string, site: string): void {
  const f = faultOn(ctx.world, plan, "split_brain");
  const s = ctx.world.stateAs(plan, "dr_plan");
  if (f) {
    s.lostS = Math.round(ctx.t - f.since);
    ctx.dropFault(f.id);
  }
  s.split = false;
  s.serving = site;
  s.failovers += 1;
}

export function startFailover(
  ctx: SiteActContext,
  planId: string,
  site: string,
  byOperator: boolean,
): void {
  const s = ctx.world.stateAs(planId, "dr_plan");
  const def = drPlanDef(ctx.world.index.entity(planId));
  if (s.split) {
    resolveSplit(ctx, planId, site);
    return;
  }
  if (s.phase === "stuck") {
    const f = faultOn(ctx.world, planId, "dr_failover_stuck");
    if (f) ctx.dropFault(f.id);
    s.phase = "failing_over";
    s.completeAt = ctx.t + RESUME_S;
    s.byOperator = byOperator;
    return;
  }
  if (def.mode === "cold") powerOn(ctx, site);
  s.phase = "failing_over";
  s.toSite = site;
  s.startedAt = ctx.t;
  s.byOperator = byOperator;
  s.completeAt = ctx.t + effectiveRtoS(ctx.world, planId, byOperator);
  delete s.downSince;
}

export function startFailback(ctx: SiteActContext, planId: string): void {
  const s = ctx.world.stateAs(planId, "dr_plan");
  const def = drPlanDef(ctx.world.index.entity(planId));
  s.phase = "failing_back";
  s.toSite = def.primary;
  s.startedAt = ctx.t;
  s.byOperator = true;
  s.completeAt = ctx.t + FAILBACK_S[def.mode];
}

export function runDrill(ctx: SiteActContext, planId: string): void {
  const s = ctx.world.stateAs(planId, "dr_plan");
  s.lastDrillAt = ctx.t;
  s.lastDrill = drillOf(ctx.world, planId);
}

/** A move took its time: the protected services run at the other site, the volumes and the clusters follow. */
export function completeMove(ctx: SiteActContext, planId: string): void {
  const { world } = ctx;
  const s = world.stateAs(planId, "dr_plan");
  const to = s.toSite;
  if (!to) return;
  const lag = Math.max(
    0,
    ...streamsOfPlan(world.index, planId).map((x) => {
      const st = world.stateAs(x.id, "replication_stream");
      return streamDef(x).mode === "sync" && st.mode === "sync" ? 0 : st.lagS;
    }),
  );
  for (const svc of protectedServices(world, planId)) {
    const state = world.stateAs(svc.id, "service");
    // an operator who moved the service to the standby places first has already done this one
    const there =
      state.runsOn.length > 0 && state.runsOn.every((n) => siteOf(world.index, n) === to);
    if (state.standby.length > 0 && !there) failover(ctx.service(), svc.id);
  }
  for (const v of volumesOfPlan(world, planId)) {
    const vs = world.stateAs(v.id, "volume");
    vs.primary = to;
    vs.promotedAt = ctx.t;
  }
  s.lostS = Math.round(to === drPlanDef(world.index.entity(planId)).primary ? 0 : lag);
  s.serving = to;
  s.phase = "idle";
  s.failovers += 1;
  delete s.toSite;
  delete s.startedAt;
  delete s.completeAt;
  delete s.downSince;
}

// ── volumes, nodes, managed databases ──────────────────────────────────────────────────────

export function promoteVolume(ctx: SiteActContext, target: string, site: string): void {
  const s = ctx.world.stateAs(target, "volume");
  s.primary = site;
  s.promotedAt = ctx.t;
}

export function restartNode(ctx: SiteActContext, target: string): void {
  const { world } = ctx;
  const s = world.stateAs(target, "db_node");
  for (const f of world.faultsOn(target)) {
    if (f.type === "db_leader_lost" || f.type === "db_node_lagging") ctx.dropFault(f.id);
  }
  const owner = world.index.incoming(target, "depends_on")[0]?.from;
  const ring = owner ? ringOf(world.index, owner) : [];
  for (const f of world.faults().filter((x) => x.type === "db_quorum_lost")) {
    if (!ringDown(world, f).includes(target)) continue;
    s.revived = true;
    if (ringDown(world, f).every((id) => world.stateAs(id, "db_node").revived)) ctx.dropFault(f.id);
  }
  s.status = "ok";
  s.role = "follower";
  s.lagS = 0;
  s.term = Math.max(s.term, ...ring.map((n) => world.stateAs(n.id, "db_node").term));
}

export function transferLeader(ctx: SiteActContext, target: string): void {
  const { world } = ctx;
  const owner = world.index.incoming(target, "depends_on")[0]?.from;
  const ring = owner ? ringOf(world.index, owner) : [];
  const term = Math.max(...ring.map((n) => world.stateAs(n.id, "db_node").term)) + 1;
  for (const n of ring) {
    const st = world.stateAs(n.id, "db_node");
    st.role = n.id === target ? "leader" : "follower";
    st.term = term;
  }
}

export function switchZone(ctx: SiteActContext, target: string, az: number): void {
  const s = ctx.world.stateAs(target, "db_managed");
  s.activeAz = az - 1;
  s.pinned = true;
  s.failovers += 1;
  s.stallUntil = ctx.t + 60;
  s.lastSwitchAt = ctx.t;
  delete s.azDownSince;
}

export function scaleStorage(ctx: SiteActContext, target: string): void {
  const s = ctx.world.stateAs(target, "db_managed");
  for (const f of ctx.world.faultsOn(target)) if (f.type === "db_storage_full") ctx.dropFault(f.id);
  s.storageUsedPct = 45;
  delete s.fullSince;
}

/** Restarting the replication agent on a host ends a stream that stopped (`replication_broken`). */
export function restartReplicator(ctx: SiteActContext, hostId: string, unit: string): void {
  if (unit !== REPLICATOR_PROCESS) return;
  for (const link of ctx.world.index.incoming(hostId, "hosted_on")) {
    if (ctx.world.index.find(link.from)?.kind !== "replication_stream") continue;
    for (const f of ctx.world.faultsOn(link.from))
      if (f.type === "replication_broken") ctx.dropFault(f.id);
  }
}
