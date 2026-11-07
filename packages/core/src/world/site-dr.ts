/**
 * Sites, the links between them and what is copied across (REQ-106, ADR-0129, docs/design-docs/site-dr-layer.md).
 *
 * A DR world has a second site (`dr_site`) with its own servers, a WAN link between the two (`site_link`), a stream of
 * copies for each protected service (`replication_stream`) and a plan (`dr_plan`) that says what recovery was promised
 * (RTO, RPO) and where the service runs now. The same file holds the consensus ring (`db_node`) and the managed
 * multi-AZ database (`db_managed`) because they are what a copy across sites leans on. Settings are props; the state of
 * each is kept by physics (physics/site.ts, physics/dbx.ts); health is read in site-health.ts and dbx-health.ts.
 * Every number that sets a promise is derived here from the choice and the link, so the chip card and the world agree.
 */
import type { Entity } from "./blueprint";
import type { BlueprintIndex } from "./graph";

export type SiteMode = "cold" | "warm" | "hot" | "active";

/** Seconds a hot site needs to see the primary gone, and to switch the services over once it has. */
export const HOT_DETECT_S = 60;
export const HOT_SWITCH_S = 30;
/** Seconds a warm site needs once an operator starts the failover (start the copies, move the names). */
export const WARM_FAILOVER_S = 900;
/** Seconds a cold site needs: power the servers on, restore the images and the last backup, start the services. */
export const COLD_FAILOVER_S = 14_400;
/** The extra seconds a cold site needs when its images are older than `STALE_IMAGE_DAYS` (they are rebuilt first). */
export const COLD_REBUILD_S = 7_200;
export const STALE_IMAGE_DAYS = 30;
/** Seconds the global balancer needs to drain a dead site of an active-active pair. */
export const ACTIVE_DRAIN_S = 30;
/** Seconds a planned failback takes (the copy is turned round and caught up). */
export const FAILBACK_S: Readonly<Record<SiteMode, number>> = {
  cold: 3_600,
  warm: 600,
  hot: 120,
  active: 0,
};
/** A cold site's data is the nightly backup: up to a day old. */
export const COLD_RPO_S = 86_400;
/** A synchronous copy that cannot be acknowledged stalls the primary this long, then falls back to asynchronous. */
export const SYNC_FALLBACK_S = 30;
/** One-way latency above which a synchronous copy makes every write slow (ms). */
export const SYNC_SLOW_MS = 10;
/** Seconds the geo volume needs to promote its copy at the other site. */
export const VOLUME_PROMOTE_S = 20;
/** The lag of a healthy asynchronous stream: a base plus a little per millisecond of the link. */
export const asyncLagS = (linkMs: number): number => 2 + linkMs * 0.2;
/** The one-way latency of a link from the distance: about 1 ms per 50 km, and 1 ms for the equipment. */
export const linkMsOf = (km: number): number => Math.max(1, Math.round(1 + km / 50));
/** Seconds the replica trails before a service reading from it is slow. */
export const STALE_STREAM_S = 300;

/** What a site mode promises, from the mode and the link (deterministic: the same chip and link give the same numbers). */
export interface DrTargets {
  readonly rtoS: number;
  readonly rpoS: number;
  /** The failover is done by itself, without an operator. */
  readonly auto: boolean;
  /** Seconds the copy trails when everything is well. */
  readonly lagS: number;
}

export function drTargets(mode: SiteMode, linkMs: number, staleImages = false): DrTargets {
  const lag = asyncLagS(linkMs);
  switch (mode) {
    case "cold":
      return {
        rtoS: COLD_FAILOVER_S + (staleImages ? COLD_REBUILD_S : 0),
        rpoS: COLD_RPO_S,
        auto: false,
        lagS: COLD_RPO_S,
      };
    case "warm":
      return { rtoS: WARM_FAILOVER_S, rpoS: Math.ceil(30 + lag * 2), auto: false, lagS: lag };
    case "hot":
      return { rtoS: HOT_DETECT_S + HOT_SWITCH_S, rpoS: 0, auto: true, lagS: 0 };
    case "active":
      return { rtoS: ACTIVE_DRAIN_S, rpoS: 0, auto: true, lagS: 0 };
  }
}

export const SITE_MODE_LABELS: Readonly<Record<SiteMode, string>> = {
  cold: "DR 콜드",
  warm: "DR 웜",
  hot: "DR 핫",
  active: "멀티 사이트 액티브-액티브",
};

/** "4시간", "15분", "90초", "0초": a promise in the words an operator uses. */
export function spanText(seconds: number): string {
  if (seconds <= 0) return "0초";
  if (seconds >= 3_600) {
    const h = seconds / 3_600;
    return `${Number.isInteger(h) ? h : h.toFixed(1)}시간`;
  }
  if (seconds >= 120 && seconds % 60 === 0) return `${seconds / 60}분`;
  return `${Math.round(seconds)}초`;
}

const num = (props: Entity["props"], key: string): number | undefined =>
  typeof props[key] === "number" ? (props[key] as number) : undefined;
const byId = (a: { id: string }, b: { id: string }): number => a.id.localeCompare(b.id);

export interface DrSiteDef {
  readonly role: "primary" | "dr" | "active";
  readonly mode: SiteMode;
  readonly distanceKm: number;
  readonly linkMs: number;
}
export const drSiteDef = (e: Entity): DrSiteDef => ({
  role: e.props.role === "dr" || e.props.role === "active" ? e.props.role : "primary",
  mode: (e.props.mode as SiteMode | undefined) ?? "warm",
  distanceKm: num(e.props, "distanceKm") ?? 100,
  linkMs: num(e.props, "linkMs") ?? 3,
});

export interface DrPlanDef {
  readonly mode: SiteMode;
  readonly primary: string;
  readonly dr: string;
  readonly rtoS: number;
  readonly rpoS: number;
  readonly auto: boolean;
  /** Share of the nodes that stand at the second site. */
  readonly share: number;
}
export const drPlanDef = (e: Entity): DrPlanDef => ({
  mode: (e.props.mode as SiteMode | undefined) ?? "warm",
  primary: String(e.props.primary ?? ""),
  dr: String(e.props.dr ?? ""),
  rtoS: num(e.props, "rtoS") ?? WARM_FAILOVER_S,
  rpoS: num(e.props, "rpoS") ?? 60,
  auto: e.props.auto === true,
  share: num(e.props, "share") ?? 1,
});

export interface StreamDef {
  readonly target: string;
  readonly mode: "async" | "sync";
  readonly link: string;
}
export const streamDef = (e: Entity): StreamDef => ({
  target: String(e.props.target ?? ""),
  mode: e.props.mode === "sync" ? "sync" : "async",
  link: String(e.props.link ?? ""),
});

export const drSites = (index: BlueprintIndex): Entity[] => [...index.ofKind("dr_site")].sort(byId);
export const drPlans = (index: BlueprintIndex): Entity[] => [...index.ofKind("dr_plan")].sort(byId);
export const streams = (index: BlueprintIndex): Entity[] =>
  [...index.ofKind("replication_stream")].sort(byId);
export const siteLinks = (index: BlueprintIndex): Entity[] =>
  [...index.ofKind("site_link")].sort(byId);
export const volumes = (index: BlueprintIndex): Entity[] => [...index.ofKind("volume")].sort(byId);

/** The building an entity of the campus stands in (walking up its parents), or undefined. */
export function buildingOf(index: BlueprintIndex, id: string): string | undefined {
  let at = index.find(id);
  for (let hops = 0; at && hops < 8; hops++) {
    if (at.kind === "building") return at.id;
    at = at.parentId ? index.find(at.parentId) : undefined;
  }
  return undefined;
}

/** The link a thing without a place of its own follows to the thing that has one. */
const HOP: Readonly<
  Partial<Record<Entity["kind"], "runs_on" | "hosted_on" | "stored_on" | "backed_by">>
> = {
  vm: "runs_on",
  app_instance: "hosted_on",
  db_instance: "hosted_on",
  db_node: "hosted_on",
  volume: "stored_on",
  storage_pool: "backed_by",
  datastore: "backed_by",
};

/**
 * The site something stands in: a server or storage array by its building, a VM or replica by the machine under it, a
 * cluster by its first instance, a pool by the array behind it, a volume by its pool. Undefined for things without a place.
 */
export function siteOf(index: BlueprintIndex, id: string, depth = 0): string | undefined {
  const e = index.find(id);
  if (!e || depth > 6) return undefined;
  const via = HOP[e.kind];
  if (via) {
    const to = index.outgoing(id, via)[0]?.to;
    return to ? siteOf(index, to, depth + 1) : undefined;
  }
  if (e.kind === "db_cluster") {
    const first = index
      .incoming(id, "member_of")
      .map((l) => l.from)
      .sort()[0];
    return first ? siteOf(index, first, depth + 1) : undefined;
  }
  const b = buildingOf(index, id);
  return b ? drSites(index).find((s) => s.props.building === b)?.id : undefined;
}

const serverCache = new WeakMap<BlueprintIndex, Map<string, readonly string[]>>();

/** The servers that stand in a site (by its building); worked out once per blueprint. */
export const serversOfSite = (index: BlueprintIndex, siteId: string): readonly string[] => {
  let all = serverCache.get(index);
  if (!all) {
    all = new Map();
    const sites = drSites(index);
    const by = new Map(sites.map((x) => [String(x.props.building), x.id]));
    const lists = new Map<string, string[]>(sites.map((x) => [x.id, []]));
    for (const srv of index.ofKind("server")) {
      const b = buildingOf(index, srv.id);
      const site = b ? by.get(b) : undefined;
      if (site) lists.get(site)?.push(srv.id);
    }
    for (const [k, v] of lists) all.set(k, v.sort());
    serverCache.set(index, all);
  }
  return all.get(siteId) ?? [];
};

/** The streams of a plan. */
export const streamsOfPlan = (index: BlueprintIndex, planId: string): Entity[] =>
  index
    .incoming(planId, "member_of")
    .map((l) => index.find(l.from))
    .filter((e): e is Entity => e?.kind === "replication_stream")
    .sort(byId);

/** The plan that protects an entity (by a stream that copies it), if any. */
export function planOfTarget(index: BlueprintIndex, id: string): Entity | undefined {
  const s = streams(index).find((x) => streamDef(x).target === id);
  const plan = s
    ? index.outgoing(s.id, "member_of").find((l) => index.find(l.to)?.kind === "dr_plan")
    : undefined;
  return plan ? index.find(plan.to) : undefined;
}

/** The link between the plan's two sites. */
export const linkOfPlan = (index: BlueprintIndex): Entity | undefined => siteLinks(index)[0];

// ── consensus ring and managed database ────────────────────────────────────────────────────

/** Seconds a ring needs to elect a leader once the old one is gone (the election timeout). */
export const ELECTION_S = 10;
/** Seconds a managed database needs to see an availability zone gone, and the write stall of the switch. */
export const AZ_DETECT_S = 30;
export const AZ_STALL_S = 60;
/** Seconds between two switches of a failover that flaps. */
export const FLAP_PERIOD_S = 300;
/** Seconds a managed database needs to grow its storage by itself once it is full. */
export const EXTEND_DELAY_S = 600;
/** Lag (seconds) above which a node of the ring serves old values. */
export const NODE_STALE_S = 30;
/** What a managed database costs an hour, won (the cloud is simulated inside the world). */
export const MANAGED_KRW_PER_HOUR = 1_800;

/** The ring of voting nodes a service leans on, by id. */
export const ringOf = (index: BlueprintIndex, serviceId: string): Entity[] =>
  index
    .outgoing(serviceId, "depends_on")
    .map((l) => index.find(l.to))
    .filter((e): e is Entity => e?.kind === "db_node")
    .sort(byId);

/** The managed database a service leans on, if any. */
export const managedOf = (index: BlueprintIndex, serviceId: string): Entity | undefined =>
  index
    .outgoing(serviceId, "depends_on")
    .map((l) => index.find(l.to))
    .find((e): e is Entity => e?.kind === "db_managed");

/** The service a node or managed database belongs to. */
export const ownerOf = (index: BlueprintIndex, id: string): string | undefined =>
  index.incoming(id, "depends_on").find((l) => index.find(l.from)?.kind === "service")?.from;

export const majority = (n: number): number => Math.floor(n / 2) + 1;

export const azNames = (e: Entity): string[] =>
  String(e.props.azs ?? "az-a,az-b")
    .split(",")
    .filter(Boolean);

/** The process that copies a stream across, as `systemctl` names it. */
export const REPLICATOR_PROCESS = "replicad";
