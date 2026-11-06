/** The fields a condition can test on the container-layer entities (REQ-096). */
import { bool, type FieldSpec, HEALTH, num } from "./field-spec";

export const K8S_CONDITION_FIELDS: Readonly<
  Record<"k8s_cluster" | "k8s_node" | "k8s_workload", Readonly<Record<string, FieldSpec>>>
> = {
  k8s_cluster: {
    health: HEALTH,
    apiUp: bool("API가 답함"),
    quorum: bool("etcd 쿼럼"),
    reschedules: num("클러스터가 옮긴 파드", "개"),
  },
  k8s_node: {
    health: HEALTH,
    status: { label: "상태", type: "enum", values: ["Ready", "NotReady"] },
    unschedulable: bool("cordon 됨"),
    diskPressure: bool("디스크 압박"),
  },
  k8s_workload: {
    health: HEALTH,
    desired: num("원하는 레플리카", "개"),
  },
};
