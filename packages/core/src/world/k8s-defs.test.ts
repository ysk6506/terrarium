/** What a cluster, a node and a workload are when the blueprint says little about them, and what points back [REQ-094]. */
import { describe, expect, test } from "vitest";
import type { Entity } from "./blueprint";
import { BlueprintIndex } from "./graph";
import {
  clusterOfK8s,
  DEFAULT_EVICTION_S,
  k8sClusterDef,
  k8sClusterProps,
  k8sNodeDef,
  k8sNodeProps,
  k8sWorkloadDef,
  k8sWorkloadProps,
} from "./k8s";
import { k8sLab } from "./test-support/k8s-lab";

const bare = (kind: Entity["kind"], props: Entity["props"] = {}): Entity => ({
  id: "x",
  kind,
  name: "x",
  props,
});

describe("defaults of the cluster layer [REQ-094]", () => {
  test("[REQ-094] a cluster with no eviction time waits the usual time, and one with it keeps it", () => {
    expect(k8sClusterDef(bare("k8s_cluster")).evictionS).toBe(DEFAULT_EVICTION_S);
    expect(k8sClusterDef(bare("k8s_cluster", { evictionS: 45 })).evictionS).toBe(45);
    expect(k8sClusterProps({ evictionS: 45 })).toEqual({ evictionS: 45 });
    expect(k8sClusterProps()).toEqual({});
  });

  test("[REQ-094] a node with nothing said is a worker of the usual size, and its props say the same back", () => {
    const node = k8sNodeDef(bare("k8s_node"));
    expect(node).toEqual({ role: "worker", cpuMilli: 7800, memMiB: 30_000 });
    expect(k8sNodeProps(node)).toEqual({ role: "worker", cpuMilli: 7800, memMiB: 30_000 });
    expect(k8sNodeDef(bare("k8s_node", { role: "control-plane", cpuMilli: 2000 }))).toMatchObject({
      role: "control-plane",
      cpuMilli: 2000,
    });
  });

  test("[REQ-094] a workload with nothing said is two small replicas in the default namespace", () => {
    const w = k8sWorkloadDef(bare("k8s_workload"));
    expect(w).toEqual({ replicas: 2, cpuMilli: 500, memMiB: 1024, namespace: "default" });
    expect(k8sWorkloadProps(w)).toEqual(w);
    expect(k8sWorkloadDef(bare("k8s_workload", { replicas: 5, namespace: "eda" }))).toMatchObject({
      replicas: 5,
      namespace: "eda",
    });
  });
});

describe("what a node belongs to [REQ-094]", () => {
  test("[REQ-094] a node belongs to its cluster, and a thing that belongs to none has no cluster", () => {
    const bp = k8sLab();
    const index = new BlueprintIndex(bp);
    const node = bp.entities.find((e) => e.kind === "k8s_node") as Entity;
    expect(clusterOfK8s(index, node.id)?.kind).toBe("k8s_cluster");
    const orphan = bp.entities.find((e) => e.kind === "service") as Entity;
    expect(clusterOfK8s(index, orphan.id)).toBeUndefined();
  });
});
