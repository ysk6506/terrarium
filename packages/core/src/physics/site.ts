/**
 * The site and DR layer moves with time and with the faults on it (REQ-106, ADR-0129): a site is up while it has powered
 * servers, the WAN link carries the copies, a stream trails by what the link and its mode say, a synchronous stream waits
 * for the link and then falls back to asynchronous, and the plan moves the services to the other site. A hot site does it
 * by itself once it has seen the primary gone, an active-active pair drains a dead site, a warm or cold site waits for an
 * operator. Where the system moves by itself the event has the cause `cluster`, so scoring can tell it from the agent's work.
 *
 * Each step: sites and the link (what is up), streams (what trails), volumes, then the plan (who serves).
 */
import {
  ACTIVE_DRAIN_S,
  asyncLagS,
  drPlanDef,
  drPlans,
  drSiteDef,
  drSites,
  type Entity,
  HOT_DETECT_S,
  type StreamState,
  SYNC_FALLBACK_S,
  serversOfSite,
  serviceDef,
  siteLinks,
  siteOf,
  streamDef,
  streams,
  volumes,
  type World,
  type WorldEvent,
} from "@terrarium/core/world";
import { hostGone } from "./app-calls";
import { CLUSTER_CAUSE } from "./db";

/** A copy that fell behind catches up this many seconds of lag each second. */
const CATCH_UP = 10;
/** Seconds a dead site must stay well before an active-active pair takes it back. */
const REJOIN_S = 60;
const PROBE = serviceDef({ id: "probe", kind: "service", name: "probe", props: {} });
void PROBE;

const note = (world: World, events: WorldEvent[], text: string, cause: string): void => {
  events.push(world.apply({ type: "note", text }, cause));
};

const fault = (world: World, id: string, type: string) =>
  world.faultsOn(id).find((f) => f.type === type);

// ── sites and the link ─────────────────────────────────────────────────────────────────────

function updateSiteState(world: World, site: Entity): void {
  const s = world.stateAs(site.id, "dr_site");
  const servers = serversOfSite(world.index, site.id);
  let up = 0;
  for (const id of servers) if (world.stateAs(id, "server").powered) up++;
  s.total = servers.length;
  s.up = up;
  const stale = fault(world, site.id, "dr_site_stale");
  s.imageAgeDays = stale
    ? (stale.params.staleDays ?? 90)
    : typeof site.props.imageAgeDays === "number"
      ? site.props.imageAgeDays
      : 7;
  delete s.why;
  if (servers.length > 0 && up === 0) {
    s.status = "down";
    s.why = fault(world, site.id, "site_power_loss")
      ? "사이트 전체의 전기가 끊겼어요"
      : "사이트의 서버가 모두 멈췄어요";
  } else if (up < servers.length) {
    s.status = "degraded";
    s.why = `서버 ${servers.length - up}대가 멈췄어요`;
  } else s.status = "ok";
}

function updateLink(world: World, link: Entity): void {
  const s = world.stateAs(link.id, "site_link");
  const second = drSites(world.index).find((x) => x.props.role !== "primary");
  const base = second ? drSiteDef(second).linkMs : 3;
  const down = fault(world, link.id, "wan_link_down");
  const slow = fault(world, link.id, "wan_degraded");
  delete s.why;
  s.lagFactor = 1;
  s.latencyMs = base;
  if (down) {
    s.status = "down";
    s.why = "회선이 끊겼어요";
  } else if (slow) {
    const factor = slow.params.factor ?? 20;
    s.status = "degraded";
    s.lagFactor = factor;
    s.latencyMs = base * (1 + factor / 4);
    s.why = `회선이 느려요(복제가 ${factor}배 밀려요)`;
  } else s.status = "ok";
}

// ── streams ────────────────────────────────────────────────────────────────────────────────

function baseLag(world: World, stream: Entity, factor: number, ms: number): number {
  const def = streamDef(stream);
  const mode = world.index.find(stream.props.plan as string)?.props.mode;
  if (mode === "cold") return 43_200;
  const geo = fault(world, def.target, "geo_replication_lag");
  const lag = def.mode === "sync" ? 0 : asyncLagS(ms) * factor;
  return geo ? Math.max(lag, geo.params.lagS ?? 900) : lag;
}

function brokenWhy(world: World, stream: Entity): string | undefined {
  const target = streamDef(stream).target;
  if (fault(world, stream.id, "replication_broken")) return "복제 에이전트가 멈췄어요";
  if (fault(world, target, "geo_replica_broken")) return "다른 사이트의 복사본이 깨졌어요";
  const host = world.index.outgoing(stream.id, "hosted_on")[0]?.to;
  if (host && hostGone(world, host)) return "복제 에이전트가 올라간 서버가 멈췄어요";
  return undefined;
}

function sourceDead(world: World, stream: Entity): boolean {
  const plan = world.index.find(String(stream.props.plan ?? ""));
  if (!plan) return false;
  const src = world.stateAs(plan.id, "dr_plan").serving || String(plan.props.primary ?? "");
  return world.index.find(src) !== undefined && world.stateAs(src, "dr_site").status === "down";
}

/** A synchronous stream waits for the link, then falls back to asynchronous; it comes back once caught up. */
function syncFallback(world: World, s: StreamState, stalled: boolean, events: WorldEvent[]): void {
  const t = world.time();
  if (!stalled) {
    delete s.stalledSince;
    return;
  }
  s.stalledSince ??= t;
  if (s.mode === "sync" && t - s.stalledSince >= SYNC_FALLBACK_S) {
    s.mode = "async";
    note(
      world,
      events,
      `동기 복제가 ${SYNC_FALLBACK_S}초 넘게 확인을 못 받아 비동기로 내려왔어요`,
      CLUSTER_CAUSE,
    );
  }
}

/** A copy that is not cut off catches up with the source; a synchronous one goes back to sync once it has. */
function catchUp(
  world: World,
  at: {
    readonly s: StreamState;
    readonly def: ReturnType<typeof streamDef>;
    readonly base: number;
    readonly dt: number;
  },
  events: WorldEvent[],
): void {
  const { s, def, base, dt } = at;
  s.lagS = s.lagS > base ? Math.max(base, s.lagS - CATCH_UP * dt) : base;
  if (def.mode === "sync" && s.mode === "async" && s.lagS <= base + 0.5) {
    s.mode = "sync";
    note(world, events, "복제가 따라잡아 다시 동기로 올라갔어요", "physics");
  }
  s.status = s.lagS > Math.max(60, base * 3) ? "lagging" : "ok";
  if (s.status === "lagging") s.why = `복제가 ${Math.round(s.lagS)}초 밀렸어요`;
}

function updateStream(world: World, stream: Entity, events: WorldEvent[], dt: number): void {
  const s = world.stateAs(stream.id, "replication_stream");
  const def = streamDef(stream);
  const link = world.index.find(def.link) ? world.stateAs(def.link, "site_link") : undefined;
  const base = baseLag(world, stream, link?.lagFactor ?? 1, link?.latencyMs ?? 3);
  const broken = brokenWhy(world, stream);
  const cut = link?.status === "down";
  delete s.why;
  if (def.mode === "sync") syncFallback(world, s, cut || broken !== undefined, events);
  // a dead source writes nothing, so the copy trails no further than it did when the source went dark
  if (sourceDead(world, stream)) return;
  if (broken || cut) {
    s.lagS += dt;
    s.status = broken ? "broken" : "lagging";
    s.why = broken ?? "회선이 끊겨 복제가 멈췄어요";
    return;
  }
  catchUp(world, { s, def, base, dt }, events);
}

/** Whether the other site of an active-active pair serves because this volume's own site is drained. */
function servedElsewhere(world: World, home: string | undefined): boolean {
  const plan = drPlans(world.index)[0];
  return (
    plan !== undefined &&
    drPlanDef(plan).mode === "active" &&
    home !== undefined &&
    world.stateAs(plan.id, "dr_plan").drained.includes(home)
  );
}

function updateVolume(world: World, vol: Entity): void {
  const s = world.stateAs(vol.id, "volume");
  const stream = streams(world.index).find((x) => streamDef(x).target === vol.id);
  s.lagS = stream ? world.stateAs(stream.id, "replication_stream").lagS : 0;
  const home = siteOf(world.index, vol.id);
  const pool = world.index.outgoing(vol.id, "stored_on")[0]?.to;
  delete s.why;
  s.status = "ok";
  if (fault(world, vol.id, "geo_replica_broken") && s.primary !== home) {
    s.status = "down";
    s.why = "올라온 복사본이 깨졌어요";
    return;
  }
  // an active-active pair writes at both sites: with one drained the other site's copy serves
  if (servedElsewhere(world, home)) return;
  if (s.primary !== home && s.primary !== "") return;
  const pst = pool ? world.stateAs(pool, "storage_pool").status : "ok";
  if (pst === "down") {
    s.status = "down";
    s.why = "볼륨이 있는 풀이 멈췄어요";
  } else if (pst === "degraded") s.status = "degraded";
}

// ── the plan ───────────────────────────────────────────────────────────────────────────────

function updateDrain(world: World, plan: Entity, events: WorldEvent[]): void {
  const s = world.stateAs(plan.id, "dr_plan");
  const t = world.time();
  for (const site of drSites(world.index)) {
    const down = world.stateAs(site.id, "dr_site").status === "down";
    const drained = s.drained.includes(site.id);
    const key = `${site.id}`;
    s.lastMarks ??= {};
    const marks = s.lastMarks;
    if (down) {
      marks[key] ??= t;
      if (!drained && t - (marks[key] as number) >= ACTIVE_DRAIN_S) {
        s.drained = [...s.drained, site.id];
        note(
          world,
          events,
          `${site.name}가 응답이 없어 글로벌 로드 밸런서가 로테이션에서 뺐어요`,
          CLUSTER_CAUSE,
        );
      }
    } else {
      delete marks[key];
      if (drained) {
        marks[`up-${key}`] ??= t;
        const upSince = marks[`up-${key}`] as number;
        if (t - upSince >= REJOIN_S) {
          s.drained = s.drained.filter((x) => x !== site.id);
          delete marks[`up-${key}`];
          note(world, events, `${site.name}가 돌아와 로테이션에 다시 넣었어요`, "physics");
        }
      } else delete marks[`up-${key}`];
    }
  }
}

function autoFailover(world: World, plan: Entity, events: WorldEvent[]): void {
  const s = world.stateAs(plan.id, "dr_plan");
  const def = drPlanDef(plan);
  if (!def.auto || s.phase !== "idle" || s.split) return;
  const other = s.serving === def.primary ? def.dr : def.primary;
  const here = world.stateAs(s.serving, "dr_site");
  if (here.status !== "down" || world.stateAs(other, "dr_site").status === "down") {
    delete s.downSince;
    return;
  }
  s.downSince ??= world.time();
  if (world.time() - s.downSince < HOT_DETECT_S) return;
  events.push(
    world.apply({ type: "dr.failover", target: plan.id, site: other, auto: true }, CLUSTER_CAUSE),
  );
}

function stepMove(world: World, plan: Entity, events: WorldEvent[]): void {
  const s = world.stateAs(plan.id, "dr_plan");
  if (s.phase !== "failing_over" && s.phase !== "failing_back") return;
  const t = world.time();
  const end = s.completeAt ?? t;
  const stuck = fault(world, plan.id, "dr_failover_stuck");
  if (
    stuck &&
    s.phase === "failing_over" &&
    t >= (s.startedAt ?? t) + (end - (s.startedAt ?? t)) / 2
  ) {
    s.phase = "stuck";
    note(world, events, "전환 자동화가 중간에서 멈췄어요", "physics");
    return;
  }
  if (t < end) return;
  const cause = s.byOperator ? "physics" : CLUSTER_CAUSE;
  events.push(world.apply({ type: "dr.complete", target: plan.id }, cause));
  note(
    world,
    events,
    `서비스가 ${world.index.find(s.serving)?.name ?? s.serving}에서 돌아요`,
    cause,
  );
}

function updatePlan(world: World, plan: Entity, events: WorldEvent[]): void {
  const s = world.stateAs(plan.id, "dr_plan");
  const def = drPlanDef(plan);
  s.split =
    fault(world, plan.id, "split_brain") !== undefined &&
    def.mode === "active" &&
    plan.props.consensus !== true;
  delete s.why;
  if (s.split) s.why = "두 사이트가 모두 자기가 주인이라고 믿어요";
  else if (s.phase === "stuck") s.why = "전환이 중간에서 멈췄어요";
  if (def.mode === "active") updateDrain(world, plan, events);
  else autoFailover(world, plan, events);
  stepMove(world, plan, events);
}

/** Step every site, link, stream, volume and plan of the world. */
export function updateSite(world: World, dt: number): WorldEvent[] {
  const events: WorldEvent[] = [];
  const idx = world.index;
  if (idx.ofKind("dr_plan").length === 0 && idx.ofKind("volume").length === 0) return events;
  for (const e of drSites(idx)) updateSiteState(world, e);
  for (const e of siteLinks(idx)) updateLink(world, e);
  for (const e of streams(idx)) updateStream(world, e, events, dt);
  for (const e of volumes(idx)) updateVolume(world, e);
  for (const e of drPlans(idx)) updatePlan(world, e, events);
  return events;
}
