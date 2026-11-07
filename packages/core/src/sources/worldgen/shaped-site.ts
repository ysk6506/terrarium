/**
 * The site layer of a "서비스부터" world (REQ-106, ADR-0129): the second site of a DR or active-active choice, the WAN link
 * between the two, a plan with the promised RTO and RPO, copies of every service at the second site (cold: all of them on
 * servers that are switched off, warm: half, hot: all, active-active: the services stand at both sites at once), a
 * replication stream for every service, database and geo volume, and the consensus ring or managed database that the
 * database choice builds. Hosts of the first site come from the first building, hosts of the second site from the second.
 */
import {
  type BlueprintIndex,
  buildingOf,
  type ChipBuild,
  type DbxBuild,
  drTargets,
  type Entity,
  linkMsOf,
  type SiteBuild,
} from "@terrarium/core/world";
import { type Laying, link, slugOf } from "./shaped-db";
import { type HostPool, nodesOn, pickHosts, splitHosts, vmsOn } from "./shaped-hosts";
import type { ServiceDraft } from "./shaped-plan";

/** Where the two sites stand and which hosts belong to each. */
export interface SitePlan {
  readonly build: SiteBuild;
  readonly a: string;
  readonly b: string;
  readonly poolA: HostPool;
  readonly poolB: HostPool;
  readonly linkMs: number;
}

const PLAN = "dr-plan";
const LINK = "wan-ab";

/** The hosts of one building, kept room by room and rack by rack. */
function poolOfBuilding(
  index: BlueprintIndex,
  pool: HostPool,
  building: string | undefined,
): HostPool {
  const out: HostPool = new Map();
  for (const [room, racks] of pool) if (buildingOf(index, room) === building) out.set(room, racks);
  return out;
}

/** The sites of the world, or undefined when the site choice builds none or the world has fewer than two buildings. */
export function planSites(
  index: BlueprintIndex,
  pool: HostPool,
  build: SiteBuild | undefined,
): SitePlan | undefined {
  if (!build) return undefined;
  const buildings = [...index.ofKind("building")].sort((x, y) => x.id.localeCompare(y.id));
  const [first, second] = buildings;
  if (!first || !second) return undefined;
  const poolA = poolOfBuilding(index, pool, first.id);
  const poolB = poolOfBuilding(index, pool, second.id);
  if (poolA.size === 0 || poolB.size === 0) return undefined;
  return {
    build,
    a: "site-a",
    b: "site-b",
    poolA,
    poolB,
    linkMs: linkMsOf(build.distanceKm),
  };
}

/** The two sites, the link between them and the plan. `consensus`: the database has a ring or a managed service. */
export function laySites(
  into: Laying,
  index: BlueprintIndex,
  plan: SitePlan,
  consensus: boolean,
): void {
  const [first, second] = [...index.ofKind("building")].sort((x, y) => x.id.localeCompare(y.id));
  const { mode, distanceKm, share } = plan.build;
  const active = mode === "active";
  const t = drTargets(mode, plan.linkMs);
  into.entities.push(
    {
      id: plan.a,
      kind: "dr_site",
      name: active ? "사이트 A" : "본 사이트",
      props: {
        building: first?.id ?? "",
        role: active ? "active" : "primary",
        mode,
        distanceKm,
        linkMs: plan.linkMs,
      },
    },
    {
      id: plan.b,
      kind: "dr_site",
      name: active ? "사이트 B" : "복구 사이트",
      props: {
        building: second?.id ?? "",
        role: active ? "active" : "dr",
        mode,
        distanceKm,
        linkMs: plan.linkMs,
        ...(mode === "cold" ? { imageAgeDays: 7 } : {}),
      },
    },
    {
      id: LINK,
      kind: "site_link",
      name: "사이트 간 회선",
      props: { a: plan.a, b: plan.b, bandwidthMbps: 10_000 },
    },
    {
      id: PLAN,
      kind: "dr_plan",
      name: "DR 계획",
      props: {
        mode,
        primary: plan.a,
        dr: plan.b,
        rtoS: t.rtoS,
        rpoS: t.rpoS,
        auto: t.auto,
        share,
        consensus,
      },
    },
  );
}

function stream(
  into: Laying,
  plan: SitePlan,
  target: string,
  host: string | undefined,
  label: string,
): void {
  const mode = plan.build.mode === "hot" || plan.build.mode === "active" ? "sync" : "async";
  const id = `rep-${slugOf(target)}`;
  into.entities.push({
    id,
    kind: "replication_stream",
    name: `${label} 복제`,
    props: { target, mode, link: LINK, plan: PLAN },
  });
  link(into, "member_of", id, PLAN);
  if (host) link(into, "hosted_on", id, host);
}

/** A service's copy at the second site: standby nodes (not for an active-active pair), and the streams. */
export function layCopies(
  into: Laying,
  index: BlueprintIndex,
  plan: SitePlan,
  svc: {
    readonly draft: ServiceDraft;
    readonly id: string;
    readonly nodes: readonly string[];
    readonly hostCount: number;
    readonly bare: boolean;
    readonly hasDb: boolean;
  },
  usedB: Set<string>,
): void {
  const { mode, share } = plan.build;
  const host = svc.nodes[0];
  if (mode !== "active") {
    const want = Math.max(1, Math.ceil(svc.hostCount * share));
    const hosts = pickHosts(plan.poolB, want, usedB);
    const copies = nodesOn(
      into,
      index,
      {
        ...svc.draft,
        key: `${svc.draft.key}-dr`,
        nodes: Math.max(1, Math.ceil(svc.draft.nodes * share)),
      },
      hosts.length > 0 ? hosts : pickHosts(plan.poolB, 1, new Set()),
      svc.bare,
    );
    for (const node of copies) link(into, "service_on", svc.id, node, "standby");
  }
  stream(into, plan, svc.id, host, svc.draft.name);
  if (svc.hasDb) stream(into, plan, `${svc.id}-db`, host, `${svc.draft.name} DB`);
  const vol = `vol-${slugOf(svc.id)}`;
  if (into.entities.some((e) => e.id === vol))
    stream(into, plan, vol, host, `${svc.draft.name} 볼륨`);
}

/** A geo-replicated volume of a stateful service: it sits on the pool and its copy stands at the other site. */
export function layVolume(
  into: Laying,
  plan: SitePlan,
  svc: { readonly id: string; readonly name: string },
  poolId: string,
): void {
  const id = `vol-${slugOf(svc.id)}`;
  into.entities.push({
    id,
    kind: "volume",
    name: `${svc.name} 볼륨`,
    props: { service: svc.id, replicaSite: plan.b, primarySite: plan.a },
  });
  link(into, "stored_on", id, poolId);
  link(into, "depends_on", svc.id, id);
}

// ── the consensus ring and the managed database ────────────────────────────────────────────

/** The ring of a service: nodes on separate hosts (and, with two sites at work, on both, with a witness that has no host). */
export function layRing(
  into: Laying,
  index: BlueprintIndex,
  ctx: {
    readonly site: SitePlan | undefined;
    readonly pool: HostPool;
    readonly used: Set<string>;
    readonly bare: boolean;
    readonly nodes: number;
  },
  draft: ServiceDraft,
  serviceId: string,
): void {
  const active = ctx.site?.build.mode === "active";
  const count = active ? 4 : ctx.nodes;
  const fromA = pickHosts(ctx.site?.poolA ?? ctx.pool, active ? 2 : count, ctx.used);
  const fromB = active && ctx.site ? pickHosts(ctx.site.poolB, 2, ctx.used) : [];
  const picked = [...fromA, ...fromB];
  const hosts = picked.length > 0 ? picked : pickHosts(ctx.pool, count, new Set());
  if (hosts.length === 0) return;
  const on = vmsOn(
    into,
    index,
    { key: `${draft.key}-ring`, count: hosts.length, props: { db: true } },
    hosts,
    ctx.bare,
  );
  const ids = on.map((host, i) => {
    const id = `${serviceId}-n${i + 1}`;
    into.entities.push({
      id,
      kind: "db_node",
      name: `${draft.name} 노드 ${i + 1}`,
      props: { seq: i + 1, ...(i === 0 ? { leader: true } : {}) },
    });
    link(into, "hosted_on", id, host);
    return id;
  });
  if (active) {
    const id = `${serviceId}-nw`;
    into.entities.push({
      id,
      kind: "db_node",
      name: `${draft.name} 증인 노드`,
      props: { seq: ids.length + 1, witness: true },
    });
    ids.push(id);
  }
  for (const id of ids) link(into, "depends_on", serviceId, id);
}

export function layManaged(
  into: Laying,
  site: SitePlan | undefined,
  draft: ServiceDraft,
  serviceId: string,
): void {
  const azs = site?.build.mode === "active" ? ["az-a", "az-b", "az-c"] : ["az-a", "az-b"];
  const id = `${serviceId}-managed`;
  into.entities.push({
    id,
    kind: "db_managed",
    name: `${draft.name} 관리형 DB`,
    props: { azs: azs.join(","), maintenance: "일요일 03:00", storageGb: 500 },
  });
  link(into, "depends_on", serviceId, id);
}

/** What the database choice builds besides a db_cluster, if anything. */
export function layDbx(
  into: Laying,
  index: BlueprintIndex,
  ctx: {
    readonly site: SitePlan | undefined;
    readonly pool: HostPool;
    readonly used: Set<string>;
    readonly build: ChipBuild;
  },
  draft: ServiceDraft,
  serviceId: string,
): void {
  const dbx: DbxBuild | undefined = ctx.build.dbx;
  if (!dbx) return;
  if (dbx.kind === "managed") layManaged(into, ctx.site, draft, serviceId);
  else
    layRing(
      into,
      index,
      {
        site: ctx.site,
        pool: ctx.pool,
        used: ctx.used,
        bare: Boolean(ctx.build.bare),
        nodes: dbx.nodes,
      },
      draft,
      serviceId,
    );
}

/** Hosts for a service's first-site nodes: both buildings for an active-active pair, the first building otherwise. */
export function hostsForService(
  site: SitePlan | undefined,
  pool: HostPool,
  used: Set<string>,
  want: number,
  spare: number,
): { hosts: Entity[]; active: Entity[]; standby: Entity[] } {
  if (!site) return splitHosts(pool, used, want, spare);
  if (site.build.mode !== "active") return splitHosts(site.poolA, used, want, spare);
  const a = pickHosts(site.poolA, Math.ceil(want / 2), used);
  const b = pickHosts(site.poolB, Math.floor(want / 2), used);
  const hosts = [...a, ...b];
  return { hosts, active: hosts, standby: [] };
}
