/**
 * The sample hall with a Kubernetes cluster under a service (REQ-096), for tests of the container layer:
 *
 *   k8s-main   control plane `cp` nodes (1 or 3), 3 workers
 *   web        4 pods (500m / 1 GiB)          the service svc-portal leans on it
 *   report     2 pods (1000m / 2 GiB)         batch work, the first to give way
 *
 * Nodes are VMs on the sample servers: workers w1..w3 on srv-a1, srv-a2, srv-b1, control-plane nodes cp1..cp3 on the
 * same three servers. A second cluster `k8s-b` with its own `web-b` workload is added when `second` is set.
 */
import type { Blueprint, Entity, Link } from "../blueprint";
import { k8sClusterProps, k8sNodeProps, k8sWorkloadProps } from "../k8s";
import { serviceProps } from "../service";
import { sampleBlueprint } from "./sample";

export interface K8sLabOptions {
  readonly controlPlane?: 1 | 3;
  readonly workers?: number;
  readonly second?: boolean;
  readonly webReplicas?: number;
  /** What each web pod asks for, in millicores (500 by default). */
  readonly webMilli?: number;
}

const HOSTS = ["srv-a1", "srv-a2", "srv-b1"] as const;
const link = (id: string, kind: Link["kind"], from: string, to: string, props = {}): Link => ({
  id,
  kind,
  from,
  to,
  props,
});

function clusterParts(
  tag: string,
  cp: number,
  workers: number,
  web: { id: string; replicas: number; milli: number },
): { entities: Entity[]; links: Link[] } {
  const entities: Entity[] = [
    { id: `k8s-${tag}`, kind: "k8s_cluster", name: `k8s-${tag}`, props: k8sClusterProps() },
  ];
  const links: Link[] = [];
  const node = (id: string, role: "control-plane" | "worker", host: string) => {
    entities.push(
      {
        id: `vm-${id}`,
        kind: "vm",
        name: `vm-${id}`,
        props: { cpuCount: 8, memoryGiB: 32, cpuDemand: 0.2 },
      },
      {
        id,
        kind: "k8s_node",
        name: id,
        props: k8sNodeProps({ role, cpuMilli: 7800, memMiB: 30_000 }),
      },
    );
    links.push(
      link(`${id}-vm`, "runs_on", `vm-${id}`, host),
      link(`${id}-ds`, "stored_on", `vm-${id}`, "ds1"),
      link(`${id}-on`, "hosted_on", id, `vm-${id}`),
      link(`${id}-in`, "member_of", id, `k8s-${tag}`),
    );
  };
  for (let i = 0; i < cp; i++) node(`${tag}-cp${i + 1}`, "control-plane", HOSTS[i % 3] as string);
  for (let i = 0; i < workers; i++) node(`${tag}-w${i + 1}`, "worker", HOSTS[i % 3] as string);
  const workload = (id: string, name: string, replicas: number, cpu: number, mem: number) => {
    entities.push({
      id,
      kind: "k8s_workload",
      name,
      props: k8sWorkloadProps({ replicas, cpuMilli: cpu, memMiB: mem, namespace: "default" }),
    });
    links.push(link(`${id}-in`, "member_of", id, `k8s-${tag}`));
  };
  workload(web.id, "web", web.replicas, web.milli, web.milli * 2);
  if (tag === "main") workload("report", "report", 2, 1000, 2048);
  return { entities, links };
}

export function k8sLab(options: K8sLabOptions = {}): Blueprint {
  const base = sampleBlueprint();
  const main = clusterParts("main", options.controlPlane ?? 3, options.workers ?? 3, {
    id: "web",
    replicas: options.webReplicas ?? 4,
    milli: options.webMilli ?? 500,
  });
  const second = options.second
    ? clusterParts("b", 1, 2, { id: "web-b", replicas: 2, milli: 500 })
    : { entities: [], links: [] };
  const svc: Entity = {
    id: "svc-portal",
    kind: "service",
    name: "사내 포털",
    props: serviceProps({ kind: "request", process: "portal", perHourKrw: 2_000_000 }),
  };
  const deps = [link("portal-web", "depends_on", "svc-portal", "web")];
  if (options.second) deps.push(link("portal-web-b", "depends_on", "svc-portal", "web-b"));
  return {
    ...base,
    id: "k8s-lab",
    entities: [...base.entities, ...main.entities, ...second.entities, svc],
    links: [...base.links, ...main.links, ...second.links, ...deps],
  };
}
