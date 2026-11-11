/**
 * Reads of the site and DR layer that more than one file needs (REQ-106): who a plan protects, how long a move takes now,
 * what a dry run would find, which nodes a quorum fault holds down. They only read; the state is kept by physics.
 */
import type { Entity } from "./blueprint";
import type { Fault } from "./faults";
import {
  asyncLagS,
  drPlanDef,
  drTargets,
  HOT_SWITCH_S,
  ringOf,
  STALE_IMAGE_DAYS,
  siteLinks,
  streamDef,
  streamsOfPlan,
} from "./site-dr";
import type { DrillResult } from "./state-site";
import type { WorldReader } from "./world";

const targets = (world: WorldReader, planId: string, kind: Entity["kind"]): Entity[] =>
  streamsOfPlan(world.index, planId)
    .map((s) => world.index.find(streamDef(s).target))
    .filter((e): e is Entity => e?.kind === kind);

/** The services a plan protects: the ones it copies. */
export const protectedServices = (world: WorldReader, planId: string): Entity[] =>
  targets(world, planId, "service");

/** The geo volumes a plan copies. */
export const volumesOfPlan = (world: WorldReader, planId: string): Entity[] =>
  targets(world, planId, "volume");

/** The state of the WAN link of the world (there is one between the two sites). */
export function linkState(world: WorldReader) {
  const link = siteLinks(world.index)[0];
  return link ? world.stateAs(link.id, "site_link") : undefined;
}

/** Whether the images of the DR site are older than the cold site can start from. */
export function imagesStale(world: WorldReader, planId: string): boolean {
  const dr = drPlanDef(world.index.entity(planId)).dr;
  return world.index.find(dr)
    ? world.stateAs(dr, "dr_site").imageAgeDays > STALE_IMAGE_DAYS
    : false;
}

/** Seconds a move that starts now takes: a hot site only has the switch left once it has seen the primary gone. */
export function effectiveRtoS(world: WorldReader, planId: string, _byOperator: boolean): number {
  const def = drPlanDef(world.index.entity(planId));
  const link = linkState(world);
  const all = drTargets(def.mode, link?.latencyMs ?? 3, imagesStale(world, planId));
  return def.mode === "hot" || def.mode === "active" ? HOT_SWITCH_S : all.rtoS;
}

/** What a dry run finds now: the time the move would take and the writes it would lose, against what was promised. */
export function drillOf(world: WorldReader, planId: string): DrillResult {
  const def = drPlanDef(world.index.entity(planId));
  const link = linkState(world);
  const ms = link?.latencyMs ?? 3;
  const all = drTargets(def.mode, ms, imagesStale(world, planId));
  const lags = streamsOfPlan(world.index, planId).map((s) => {
    const st = world.stateAs(s.id, "replication_stream");
    if (st.mode === "sync" && st.status === "ok") return 0;
    return st.status === "broken" ? Math.max(st.lagS, asyncLagS(ms)) : st.lagS;
  });
  const rpoS = Math.round(def.mode === "cold" ? all.rpoS : Math.max(0, ...lags));
  return {
    rtoS: all.rtoS,
    rpoS,
    meetsRto: all.rtoS <= def.rtoS,
    meetsRpo: rpoS <= def.rpoS,
  };
}

/** The nodes a quorum fault holds down: its own and the next ones round the ring, `down` in all. */
export function ringDown(world: WorldReader, fault: Fault): string[] {
  const owner = world.index.incoming(fault.target, "depends_on")[0]?.from;
  const ring = owner ? ringOf(world.index, owner) : [];
  const at = Math.max(
    0,
    ring.findIndex((n) => n.id === fault.target),
  );
  const n = Math.min(ring.length, Math.round(fault.params.down ?? 2));
  return Array.from({ length: n }, (_, k) => (ring[(at + k) % ring.length] as Entity).id);
}
