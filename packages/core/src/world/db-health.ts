/**
 * How a database or a storage pool looks to the services that lean on it (REQ-095, ADR-0107 item 6). Like the rest of
 * service health nothing here is simulated: the verdict is read off the state physics keeps (physics/db.ts) and off the
 * settings of the cluster, so putting the state right (a promotion, a path switch, a finished re-copy) brings the
 * service back by itself.
 *
 * The rules, for a service that needs the cluster:
 *   - a primary that can write                         ok (slow when a copy is more than `lagSlowS` seconds behind)
 *   - the primary is up but cannot write (disk full)   a request service reads on and is slow; others stop
 *   - no primary, but a secondary that can be read     a request service is slow (read only); others stop
 *   - no primary and nothing to read                   stopped (before a promotion, or for a single instance)
 *   - shared disk, several active nodes                one node left is slow, none left is stopped
 *   - two primaries (split brain)                      a request service is slow, the others stop
 * and for a pool: stopped when its status is down, slow when it is degraded.
 */

import type { Entity } from "./blueprint";
import { dbClusterDef, instancesOf } from "./db";
import type { ServiceDef } from "./service";
import type { StateOf } from "./state";
import type { WorldReader } from "./world";

export interface DepVerdict {
  readonly state: "ok" | "slow" | "dead";
  /** One short sentence when not ok. */
  readonly why?: string;
}

const OK: DepVerdict = { state: "ok" };
const dead = (why: string): DepVerdict => ({ state: "dead", why });
const slow = (why: string): DepVerdict => ({ state: "slow", why });

/** A request service can still answer reads; the others need to write and stop. */
const readsOnly = (def: ServiceDef, why: string): DepVerdict =>
  def.kind === "request" ? slow(why) : dead(why);

interface Member {
  readonly entity: Entity;
  readonly s: StateOf<"db_instance">;
}

const up = (m: Member): boolean => m.s.status !== "down";

function members(world: WorldReader, cluster: Entity): Member[] {
  return instancesOf(world.index, cluster.id).map((entity) => ({
    entity,
    s: world.stateAs(entity.id, "db_instance"),
  }));
}

function sharedVerdict(list: readonly Member[]): DepVerdict {
  const active = list.filter((m) => m.s.role === "primary");
  const alive = active.filter(up);
  if (alive.length === 0) return dead("공유 디스크를 쓰는 노드가 모두 멈췄어요");
  if (alive.some((m) => m.s.readOnly)) return slow(alive.find((m) => m.s.readOnly)?.s.why ?? "");
  if (alive.length < active.length)
    return slow(`노드 ${active.length}개 중 ${alive.length}개로 버티고 있어요`);
  return OK;
}

function withoutWriter(
  world: WorldReader,
  cluster: Entity,
  list: readonly Member[],
  def: ServiceDef,
): DepVerdict {
  const state = world.stateAs(cluster.id, "db_cluster");
  const cdef = dbClusterDef(cluster);
  const primary = list.find((m) => m.entity.id === state.primary);
  if (primary && up(primary) && primary.s.readOnly)
    return readsOnly(def, `프라이머리가 쓰기를 못 해요 — ${primary.s.why ?? "쓰기 실패"}`);
  const readable = list.some(
    (m) =>
      up(m) &&
      m.s.role === "secondary" &&
      (cdef.shape === "replicated" || cdef.shape === "auto_failover"),
  );
  const pending = cdef.failover === "auto" ? "곧 스스로 승격해요" : "사람이 승격해야 해요";
  if (readable) return readsOnly(def, `프라이머리가 멈춰 읽기만 돼요 — ${pending}`);
  return dead(
    list.some((m) => up(m) && m.s.role !== "primary")
      ? `프라이머리가 멈췄어요 — 이어받을 인스턴스가 있지만 ${pending}`
      : "프라이머리가 멈췄고 이어받을 인스턴스가 없어요",
  );
}

/** A cluster as the service that needs it sees it. */
export function clusterVerdict(world: WorldReader, cluster: Entity, def: ServiceDef): DepVerdict {
  const state = world.stateAs(cluster.id, "db_cluster");
  const cdef = dbClusterDef(cluster);
  const list = members(world, cluster);
  const name = cluster.name;
  if (state.splitBrain)
    return def.kind === "request"
      ? slow(`${name}: 인스턴스 둘이 모두 프라이머리라고 해서 데이터가 어긋나요`)
      : dead(`${name}: 인스턴스 둘이 모두 프라이머리라고 해서 쓰면 데이터가 어긋나요`);
  if (state.startsAt !== undefined && world.time() < state.startsAt)
    return dead(`${name}: 대기 쪽 인스턴스가 이어받으려고 뜨는 중이에요`);
  if (cdef.shape === "shared_aa") {
    const v = sharedVerdict(list);
    return v.why ? { ...v, why: `${name}: ${v.why}` } : v;
  }
  const writer = list.find((m) => m.entity.id === state.primary && up(m) && !m.s.readOnly);
  if (!writer) {
    const v = withoutWriter(world, cluster, list, def);
    return { ...v, why: `${name}: ${v.why ?? ""}` };
  }
  if (writer.s.status === "degraded")
    return slow(`${name}: ${writer.s.why ?? "프라이머리가 느려요"}`);
  const behind = list.find((m) => up(m) && m.s.role !== "primary" && m.s.lagS > cdef.lagSlowS);
  if (behind)
    return slow(`${name}: ${behind.entity.name}의 복제 지연이 ${Math.round(behind.s.lagS)}초예요`);
  return OK;
}

/** A pool as the service that needs it sees it. */
export function poolVerdict(world: WorldReader, pool: Entity): DepVerdict {
  const s = world.stateAs(pool.id, "storage_pool");
  if (s.status === "down") return dead(`${pool.name}: ${s.why ?? "멈췄어요"}`);
  if (s.status === "degraded") return slow(`${pool.name}: ${s.why ?? "느려요"}`);
  return OK;
}

/** One thing a service leans on (`depends_on`): a cluster, an instance of one, or a pool. */
export function dependencyVerdict(world: WorldReader, dep: Entity, def: ServiceDef): DepVerdict {
  if (dep.kind === "storage_pool") return poolVerdict(world, dep);
  if (dep.kind === "db_cluster") return clusterVerdict(world, dep, def);
  if (dep.kind === "db_instance") {
    const owner = world.index.outgoing(dep.id, "member_of")[0]?.to;
    const cluster = owner ? world.index.find(owner) : undefined;
    return cluster ? clusterVerdict(world, cluster, def) : OK;
  }
  return OK;
}
