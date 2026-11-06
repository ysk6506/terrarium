/**
 * The alarms of the database and storage-HA layers (REQ-095): an instance that is down or cannot write, a copy that
 * is far behind, two primaries, a cluster with no primary, a pool that is down or short of copies, a controller that
 * failed or lost its path, a storage node that is gone. They sit on the equipment they are about, so a diagnosis can
 * name it (the instance, the controller, the node) and the topology can colour it.
 */
import { dbClusterDef, instancesOf, type StateOf, type World } from "@terrarium/core/world";
import type { Draft } from "./alarm-scan";

function instanceAlarms(world: World, out: Draft[]): void {
  for (const e of world.index.ofKind("db_instance")) {
    const s = world.stateAs(e.id, "db_instance");
    if (s.status === "down")
      out.push({
        entityId: e.id,
        code: "db_instance_down",
        severity: s.role === "primary" ? "critical" : "warning",
        message: `${e.name} 인스턴스가 멈췄어요${s.why ? ` — ${s.why}` : ""}`,
      });
    else if (s.readOnly)
      out.push({
        entityId: e.id,
        code: "db_read_only",
        severity: "critical",
        message: `${e.name}에 쓸 수 없어요${s.why ? ` — ${s.why}` : ""}`,
      });
    const cluster = world.index.outgoing(e.id, "member_of")[0]?.to;
    const limit = cluster ? dbClusterDef(world.index.entity(cluster)).lagSlowS : 30;
    if (s.status !== "down" && s.role !== "primary" && s.lagS > limit)
      out.push({
        entityId: e.id,
        code: "db_replication_lag",
        severity: "warning",
        message: `${e.name} 복제 지연이 ${Math.round(s.lagS)}초예요`,
      });
  }
}

function clusterAlarms(world: World, out: Draft[]): void {
  for (const e of world.index.ofKind("db_cluster")) {
    const s = world.stateAs(e.id, "db_cluster");
    if (s.splitBrain)
      out.push({
        entityId: e.id,
        code: "db_split_brain",
        severity: "critical",
        message: `${e.name}에서 인스턴스 둘이 모두 프라이머리라고 해요(스플릿 브레인)`,
      });
    const primary = s.primary ? world.stateAs(s.primary, "db_instance") : undefined;
    if (
      !s.splitBrain &&
      (!primary || primary.status === "down") &&
      dbClusterDef(e).shape !== "shared_aa"
    )
      out.push({
        entityId: e.id,
        code: "db_no_primary",
        severity: "critical",
        message: `${e.name}에 쓸 수 있는 프라이머리가 없어요`,
      });
    const members = instancesOf(world.index, e.id);
    if (members.some((m) => world.stateAs(m.id, "db_instance").restoreError))
      out.push({
        entityId: e.id,
        code: "db_restore_failed",
        severity: "warning",
        message: `${e.name} 백업 복원이 실패했어요`,
      });
  }
}

function storageAlarms(world: World, out: Draft[]): void {
  for (const e of world.index.ofKind("storage_pool")) {
    const s = world.stateAs(e.id, "storage_pool");
    if (s.status !== "ok")
      out.push({
        entityId: e.id,
        code: s.status === "down" ? "storage_pool_down" : "storage_pool_degraded",
        severity: s.status === "down" ? "critical" : "warning",
        message: `${e.name} ${s.status === "down" ? "멈췄어요" : "느려요"}${s.why ? ` — ${s.why}` : ""}`,
      });
  }
  for (const e of world.index.ofKind("storage_controller")) {
    const s: StateOf<"storage_controller"> = world.stateAs(e.id, "storage_controller");
    if (s.status === "down")
      out.push({
        entityId: e.id,
        code: "storage_controller_down",
        severity: "critical",
        message: `${e.name} 컨트롤러가 고장 났어요`,
      });
    else if (s.path === "cut")
      out.push({
        entityId: e.id,
        code: "storage_path_cut",
        severity: "warning",
        message: `${e.name} 경로가 끊겼어요`,
      });
  }
  for (const f of world.faults())
    if (f.type === "storage_node_lost")
      out.push({
        entityId: f.target,
        code: "storage_node_lost",
        severity: "critical",
        message: `${world.index.entity(f.target).name} 분산 스토리지 노드가 사라졌어요`,
      });
}

/** The alarms of every database, pool, controller and lost node. */
export function dbAlarms(world: World, out: Draft[]): void {
  if (world.index.ofKind("db_instance").length > 0) {
    instanceAlarms(world, out);
    clusterAlarms(world, out);
  }
  if (world.index.ofKind("storage_pool").length > 0) storageAlarms(world, out);
}
