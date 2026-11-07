/**
 * The handlers of the site and DR tools (REQ-106): they read the state the physics keeps and give a command to the world.
 * The status tools say what an operator's console would show; the actions say plainly how long the move takes and what it
 * loses before they do it.
 */
import { InvalidValueError } from "@terrarium/core/kernel";
import {
  azNames,
  drPlanDef,
  drPlans,
  drSiteDef,
  drSites,
  type Entity,
  EXTEND_DELAY_S,
  effectiveRtoS,
  FAILBACK_S,
  MANAGED_KRW_PER_HOUR,
  majority,
  ringOf,
  siteLinks,
  spanText,
  streamDef,
  streams,
  volumes,
  type WorldPort,
} from "@terrarium/core/world";
import type { Args, ToolContext } from "./handlers";

type Handler = (ctx: ToolContext, args: Args) => unknown;

const opt = (args: Args, key: string): string | undefined =>
  args[key] === undefined || args[key] === "" ? undefined : String(args[key]);
const need = (args: Args, key: string): string => String(args[key] ?? "");
const name = (world: WorldPort, id: string): string => world.index.find(id)?.name ?? id;

function planOf(world: WorldPort, id?: string): Entity {
  const plan = id ? drPlans(world.index).find((p) => p.id === id) : drPlans(world.index)[0];
  if (!plan)
    throw new InvalidValueError("이 세계에는 복구 사이트가 없어요 (사이트 칩 'DR'이 필요해요)");
  return plan;
}

function planRow(world: WorldPort, plan: Entity) {
  const def = drPlanDef(plan);
  const s = world.stateAs(plan.id, "dr_plan");
  return {
    id: plan.id,
    mode: def.mode,
    servingSite: s.serving,
    phase: s.phase,
    ...(s.toSite ? { movingTo: s.toSite } : {}),
    ...(s.completeAt !== undefined
      ? { secondsLeft: Math.max(0, Math.round(s.completeAt - world.time())) }
      : {}),
    promisedRtoSeconds: def.rtoS,
    promisedRpoSeconds: def.rpoS,
    movesByItself: def.auto,
    secondsOfWritesLostAtLastMove: s.lostS,
    moves: s.failovers,
    ...(s.split ? { splitBrain: true } : {}),
    ...(s.phase === "stuck" ? { stuck: true, hint: "dr_failover로 마저 끝낼 수 있어요" } : {}),
    ...(s.lastDrill ? { lastDrill: { ...s.lastDrill, at: s.lastDrillAt } } : {}),
    ...(s.drained.length > 0 ? { drainedSites: s.drained } : {}),
  };
}

const siteStatus: Handler = (ctx, args) => {
  const { world } = ctx;
  const only = opt(args, "site");
  const sites = drSites(world.index).filter((e) => !only || e.id === only);
  if (sites.length === 0) throw new InvalidValueError("이 세계에는 복구 사이트가 없어요");
  return {
    sites: sites.map((e) => {
      const s = world.stateAs(e.id, "dr_site");
      const def = drSiteDef(e);
      return {
        id: e.id,
        name: e.name,
        role: def.role,
        mode: def.mode,
        distanceKm: def.distanceKm,
        status: s.status,
        ...(s.why ? { why: s.why } : {}),
        serversUp: s.up,
        serversTotal: s.total,
        ...(def.mode === "cold" ? { imageAgeDays: s.imageAgeDays } : {}),
      };
    }),
    plans: drPlans(world.index).map((p) => planRow(world, p)),
  };
};

const replicationStatus: Handler = (ctx, args) => {
  const { world } = ctx;
  const only = opt(args, "copies");
  const list = streams(world.index).filter((e) => !only || streamDef(e).target === only);
  if (list.length === 0) throw new InvalidValueError("이 세계에는 사이트 간 복제가 없어요");
  return {
    streams: list.map((e) => {
      const s = world.stateAs(e.id, "replication_stream");
      const def = streamDef(e);
      return {
        id: e.id,
        copies: def.target,
        copiesName: name(world, def.target),
        configuredMode: def.mode,
        mode: s.mode,
        status: s.status,
        ...(s.why ? { why: s.why } : {}),
        lagSeconds: Math.round(s.lagS),
        ...(s.stalledSince !== undefined
          ? { stalledSeconds: Math.round(world.time() - s.stalledSince) }
          : {}),
      };
    }),
  };
};

const wanStatus: Handler = (ctx, args) => {
  const { world } = ctx;
  const only = opt(args, "link");
  const link = siteLinks(world.index).find((e) => !only || e.id === only);
  if (!link) throw new InvalidValueError("이 세계에는 사이트 간 회선이 없어요");
  const s = world.stateAs(link.id, "site_link");
  return {
    id: link.id,
    status: s.status,
    ...(s.why ? { why: s.why } : {}),
    latencyMs: Math.round(s.latencyMs * 10) / 10,
    bandwidthMbps: Number(link.props.bandwidthMbps ?? 10_000),
    lagFactor: s.lagFactor,
  };
};

const drFailover: Handler = (ctx, args) => {
  const { world } = ctx;
  const plan = planOf(world);
  const site = need(args, "site");
  if (world.index.find(site)?.kind !== "dr_site")
    throw new InvalidValueError(
      `'${site}'는 사이트가 아니에요 (${drSites(world.index)
        .map((x) => x.id)
        .join(", ")})`,
    );
  const before = world.stateAs(plan.id, "dr_plan");
  const wasStuck = before.phase === "stuck";
  const split = before.split;
  const lagNow = Math.max(
    0,
    ...streams(world.index).map((x) => world.stateAs(x.id, "replication_stream").lagS),
  );
  world.apply({ type: "dr.failover", target: plan.id, site }, "tool:dr_failover");
  const after = world.stateAs(plan.id, "dr_plan");
  return {
    plan: plan.id,
    site,
    ...(split
      ? { resolvedSplitBrain: true, keptSite: site, secondsOfWritesDiscarded: after.lostS }
      : {
          etaSeconds: wasStuck ? 120 : effectiveRtoS(world, plan.id, true),
          etaText: spanText(wasStuck ? 120 : effectiveRtoS(world, plan.id, true)),
          expectedLossSeconds: Math.round(lagNow),
        }),
    note: split
      ? "남긴 사이트가 주인이 됐어요. 다른 사이트의 갈라진 쓰기는 버렸어요."
      : "전환을 시작했어요. site_status로 진행을 보세요. 끝나면 서비스가 그 사이트에서 돌아요.",
  };
};

const drFailback: Handler = (ctx, args) => {
  const { world } = ctx;
  const plan = planOf(world, opt(args, "plan"));
  world.apply({ type: "dr.failback", target: plan.id }, "tool:dr_failback");
  const mode = drPlanDef(plan).mode;
  return {
    plan: plan.id,
    etaSeconds: FAILBACK_S[mode],
    etaText: spanText(FAILBACK_S[mode]),
    note: "복제를 거꾸로 돌려 따라잡은 뒤 본 사이트로 돌려놔요. site_status로 보세요.",
  };
};

const drDrill: Handler = (ctx, args) => {
  const { world } = ctx;
  const plan = planOf(world, opt(args, "plan"));
  world.apply({ type: "dr.drill", target: plan.id }, "tool:dr_drill");
  const s = world.stateAs(plan.id, "dr_plan");
  const def = drPlanDef(plan);
  const r = s.lastDrill;
  return {
    plan: plan.id,
    dryRun: true,
    achievableRtoSeconds: r?.rtoS,
    achievableRtoText: spanText(r?.rtoS ?? 0),
    achievableRpoSeconds: r?.rpoS,
    promisedRtoSeconds: def.rtoS,
    promisedRpoSeconds: def.rpoS,
    meetsRto: r?.meetsRto,
    meetsRpo: r?.meetsRpo,
    note: "서비스는 옮기지 않았어요. 지금 전환하면 이만큼 걸리고 이만큼 잃어요.",
  };
};

// ── volumes ────────────────────────────────────────────────────────────────────────────────

const volumeStatus: Handler = (ctx, args) => {
  const { world } = ctx;
  const only = opt(args, "volume");
  const list = volumes(world.index).filter((v) => !only || v.id === only);
  if (world.index.ofKind("volume").length === 0)
    throw new InvalidValueError(
      "이 세계에는 지역 복제 볼륨이 없어요 (스토리지 칩 '지역 복제'가 필요해요)",
    );
  if (only && list.length === 0) throw new InvalidValueError(`'${only}'는 볼륨이 아니에요`);
  return {
    volumes: list.map((v) => {
      const s = world.stateAs(v.id, "volume");
      return {
        id: v.id,
        name: v.name,
        service: v.props.service,
        writableSite: s.primary,
        replicaSite: v.props.replicaSite,
        status: s.status,
        ...(s.why ? { why: s.why } : {}),
        lagSeconds: Math.round(s.lagS),
        replicaBroken: world.faultsOn(v.id).some((f) => f.type === "geo_replica_broken"),
      };
    }),
  };
};

const volumePromote: Handler = (ctx, args) => {
  const { world } = ctx;
  const volume = need(args, "volume");
  const site = need(args, "site");
  const lag = world.index.find(volume) ? world.stateAs(volume, "volume").lagS : 0;
  world.apply({ type: "volume.promote", target: volume, site }, "tool:volume_promote");
  return {
    volume,
    writableSite: site,
    secondsOfWritesLost: Math.round(lag),
    note: "복사본이 주인이 됐어요. 서비스가 다른 사이트에 있으면 failover_service로 같이 옮기세요.",
  };
};

// ── consensus ring and managed database ────────────────────────────────────────────────────

const clusterStatus: Handler = (ctx, args) => {
  const { world } = ctx;
  const only = opt(args, "service");
  const owners = world.index
    .ofKind("service")
    .filter((s) => ringOf(world.index, s.id).length > 0 && (!only || s.id === only))
    .sort((a, b) => a.id.localeCompare(b.id));
  if (world.index.ofKind("db_node").length === 0)
    throw new InvalidValueError(
      "이 세계에는 합의 DB가 없어요 (데이터베이스 칩 '분산 SQL'이 필요해요)",
    );
  return {
    rings: owners.map((svc) => {
      const ring = ringOf(world.index, svc.id);
      const rows = ring.map((n) => {
        const s = world.stateAs(n.id, "db_node");
        const host = world.index.outgoing(n.id, "hosted_on")[0]?.to;
        return {
          id: n.id,
          ...(host ? { host } : {}),
          role: s.role,
          status: s.status,
          ...(s.why ? { why: s.why } : {}),
          term: s.term,
          lagSeconds: Math.round(s.lagS),
          ...(n.props.witness === true ? { witness: true } : {}),
        };
      });
      const up = rows.filter((r) => r.status !== "down").length;
      const leader = rows.find((r) => r.role === "leader" && r.status !== "down");
      return {
        service: svc.id,
        nodes: rows,
        votesNeeded: majority(ring.length),
        votesUp: up,
        hasQuorum: up >= majority(ring.length),
        leader: leader?.id ?? null,
        electionRunning: !leader && up >= majority(ring.length),
      };
    }),
  };
};

const nodeRestart: Handler = (ctx, args) => {
  const node = need(args, "node");
  ctx.world.apply({ type: "dbnode.restart", target: node }, "tool:db_node_restart");
  return {
    node,
    note: "다시 시작했어요. 팔로워로 돌아와 따라잡아요. db_cluster_status로 확인하세요.",
  };
};

const transferLeader: Handler = (ctx, args) => {
  const node = need(args, "node");
  ctx.world.apply({ type: "dbnode.transfer", target: node }, "tool:db_transfer_leader");
  return { node, leader: node, note: "리더를 넘겼어요. 임기가 하나 올랐어요." };
};

function azNumber(db: Entity, raw: string): number {
  const names = azNames(db);
  const byName = names.indexOf(raw);
  return byName >= 0 ? byName + 1 : Number(raw);
}

const managedStatus: Handler = (ctx, args) => {
  const { world } = ctx;
  const only = opt(args, "service");
  if (world.index.ofKind("db_managed").length === 0)
    throw new InvalidValueError(
      "이 세계에는 관리형 DB가 없어요 (데이터베이스 칩 '관리형 멀티 AZ'가 필요해요)",
    );
  const list = [...world.index.ofKind("db_managed")]
    .filter((e) => !only || world.index.incoming(e.id, "depends_on").some((l) => l.from === only))
    .sort((a, b) => a.id.localeCompare(b.id));
  return {
    databases: list.map((e) => {
      const s = world.stateAs(e.id, "db_managed");
      const down = world.faultsOn(e.id).find((f) => f.type === "db_az_failure");
      return {
        id: e.id,
        name: e.name,
        status: s.status,
        ...(s.why ? { why: s.why } : {}),
        zones: azNames(e).map((n, i) => ({
          name: n,
          number: i + 1,
          primary: i === s.activeAz,
          up: !(down && (down.params.az ?? 1) === i + 1),
        })),
        ...(s.stallUntil !== undefined && s.stallUntil > world.time()
          ? { writeStallSecondsLeft: Math.round(s.stallUntil - world.time()) }
          : {}),
        storageUsedPercent: Math.round(s.storageUsedPct),
        ...(s.fullSince !== undefined
          ? {
              autoExtendInSeconds: Math.max(
                0,
                Math.round(EXTEND_DELAY_S - (world.time() - s.fullSince)),
              ),
            }
          : {}),
        zoneSwitches: s.failovers,
        pinned: s.pinned,
        maintenanceWindow: String(e.props.maintenance ?? "일요일 03:00"),
        costPerHourKrw: MANAGED_KRW_PER_HOUR * azNames(e).length,
      };
    }),
  };
};

const managedFailover: Handler = (ctx, args) => {
  const { world } = ctx;
  const db = need(args, "db");
  const entity = world.index.find(db);
  if (entity?.kind !== "db_managed") throw new InvalidValueError(`'${db}'는 관리형 DB가 아니에요`);
  const az = azNumber(entity, need(args, "az"));
  world.apply({ type: "dbm.failover", target: db, az }, "tool:db_managed_failover");
  return {
    db,
    zone: azNames(entity)[az - 1],
    note: "그 영역을 주인으로 고정했어요. 쓰기가 1분쯤 멈췄다 돌아와요.",
  };
};

const managedScale: Handler = (ctx, args) => {
  const db = need(args, "db");
  ctx.world.apply({ type: "dbm.scale", target: db }, "tool:db_managed_scale_storage");
  return { db, note: "저장소를 늘렸어요. 쓰기가 바로 돌아와요. 요금이 시간당 조금 올라요." };
};

export const SITE_HANDLERS: Readonly<Record<string, Handler>> = {
  site_status: siteStatus,
  replication_status: replicationStatus,
  wan_status: wanStatus,
  dr_failover: drFailover,
  dr_failback: drFailback,
  dr_drill: drDrill,
  volume_replication_status: volumeStatus,
  volume_promote: volumePromote,
  db_cluster_status: clusterStatus,
  db_node_restart: nodeRestart,
  db_transfer_leader: transferLeader,
  db_managed_status: managedStatus,
  db_managed_failover: managedFailover,
  db_managed_scale_storage: managedScale,
};
