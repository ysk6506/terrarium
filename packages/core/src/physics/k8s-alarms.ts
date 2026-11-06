/**
 * The alarms of the container layer (REQ-096): a node that is NotReady or short of disk, a control plane without an
 * API, pods that crash or wait. They sit on the node, cluster or workload they are about, so a diagnosis can name it.
 */
import type { World } from "@terrarium/core/world";
import type { Draft } from "./alarm-scan";

function nodeAlarms(world: World, out: Draft[]): void {
  for (const e of world.index.ofKind("k8s_node")) {
    const s = world.stateAs(e.id, "k8s_node");
    if (s.status === "NotReady")
      out.push({
        entityId: e.id,
        code: "k8s_node_not_ready",
        severity: "critical",
        message: `노드 ${e.name}이 NotReady예요${s.why ? ` — ${s.why}` : ""}`,
      });
    else if (s.diskPressure)
      out.push({
        entityId: e.id,
        code: "k8s_disk_pressure",
        severity: "warning",
        message: `노드 ${e.name}에 DiskPressure가 났어요`,
      });
  }
}

function clusterAlarms(world: World, out: Draft[]): void {
  for (const e of world.index.ofKind("k8s_cluster")) {
    const s = world.stateAs(e.id, "k8s_cluster");
    if (!s.apiUp)
      out.push({
        entityId: e.id,
        code: "k8s_api_down",
        severity: "critical",
        message: `${e.name}의 API가 답하지 않아요${s.why ? ` — ${s.why}` : ""}`,
      });
    else if (s.cpUp < s.cpTotal)
      out.push({
        entityId: e.id,
        code: "k8s_control_plane_degraded",
        severity: "warning",
        message: `${e.name}의 컨트롤 플레인 ${s.cpUp}/${s.cpTotal}개만 살아 있어요`,
      });
  }
}

const WORKLOAD_ALARMS = [
  ["CrashLoopBackOff", "k8s_crashloop", "critical", "CrashLoopBackOff예요"],
  ["Pending", "k8s_pods_pending", "warning", "Pending이에요(들어갈 노드가 없어요)"],
  ["ImagePullBackOff", "k8s_image_pull_backoff", "warning", "이미지를 못 받아요(ImagePullBackOff)"],
] as const;

function workloadAlarms(world: World, out: Draft[]): void {
  for (const e of world.index.ofKind("k8s_workload")) {
    const s = world.stateAs(e.id, "k8s_workload");
    for (const [phase, code, severity, words] of WORKLOAD_ALARMS) {
      const n = s.pods.filter((p) => p.phase === phase).length;
      if (n > 0)
        out.push({ entityId: e.id, code, severity, message: `${e.name}의 파드 ${n}개가 ${words}` });
    }
  }
}

export function k8sAlarms(world: World, out: Draft[]): void {
  nodeAlarms(world, out);
  clusterAlarms(world, out);
  workloadAlarms(world, out);
}
