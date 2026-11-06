/**
 * What the fake shell and the kubectl tools print for the container layer (REQ-096): `kubectl get nodes|pods`,
 * `kubectl describe node`, `crictl ps`, and the logs of a pod. As everywhere in the shell the output is made from the
 * state in the shape of the real tool. The API view is told as the API tells it: a pod on a node that has been silent
 * for less than the grace period still says Running, and a pod whose network plugin is dead says Running too.
 */
import {
  type Entity,
  k8sNodeDef,
  k8sWorkloadDef,
  nodesOfCluster,
  type PodState,
  type WorldPort,
  workloadsOfCluster,
} from "@terrarium/core/world";

export interface ShellOut {
  readonly output: string;
  readonly exitCode: number;
}

const REFUSED = (host: string): ShellOut => ({
  output: `The connection to the server ${host}:6443 was refused - did you specify the right host or port?`,
  exitCode: 1,
});

const age = (t: number, since: number): string => {
  const s = Math.max(0, Math.round(t - since));
  if (s < 120) return `${s}s`;
  if (s < 7200) return `${Math.floor(s / 60)}m`;
  if (s < 172_800) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86_400)}d`;
};

function pad(rows: readonly (readonly string[])[]): string {
  const widths = (rows[0] ?? []).map((_, i) => Math.max(...rows.map((r) => (r[i] ?? "").length)));
  return rows
    .map((r) =>
      r
        .map((c, i) => c.padEnd((widths[i] ?? 0) + 3))
        .join("")
        .trimEnd(),
    )
    .join("\n");
}

/** The cluster whose node runs on this host, if the host is a node. */
export function nodeOnHost(world: WorldPort, hostId: string): Entity | undefined {
  return world.index
    .incoming(hostId, "hosted_on")
    .map((l) => world.index.find(l.from))
    .find((e): e is Entity => e?.kind === "k8s_node");
}

export const clusterOfNode = (world: WorldPort, nodeId: string): Entity | undefined => {
  const to = world.index.outgoing(nodeId, "member_of")[0]?.to;
  return to ? world.index.find(to) : undefined;
};

// ── the API's words ──────────────────────────────────────────────────────────────────────────

export function nodeStatusWord(world: WorldPort, id: string): string {
  const s = world.stateAs(id, "k8s_node");
  const base = s.status === "Ready" ? "Ready" : "NotReady";
  return s.unschedulable ? `${base},SchedulingDisabled` : base;
}

/** What `kubectl get pods` shows in READY and STATUS. */
export function podWords(world: WorldPort, p: PodState): { ready: string; status: string } {
  const node = p.node ? world.stateAs(p.node, "k8s_node") : undefined;
  if (p.phase === "Running")
    return { ready: node?.status === "NotReady" ? "0/1" : "1/1", status: "Running" };
  if (p.phase === "ContainerCreating") return { ready: "0/1", status: "ContainerCreating" };
  return { ready: "0/1", status: p.phase === "Pending" ? "Pending" : p.phase };
}

export const podEntries = (world: WorldPort, clusterId: string) =>
  workloadsOfCluster(world.index, clusterId).flatMap((w) =>
    world.stateAs(w.id, "k8s_workload").pods.map((p) => ({ w, p })),
  );

export function nodesTable(world: WorldPort, clusterId: string): string {
  const t = world.time();
  const rows: string[][] = [["NAME", "STATUS", "ROLES", "AGE", "VERSION"]];
  for (const n of nodesOfCluster(world.index, clusterId)) {
    const role = k8sNodeDef(n).role;
    rows.push([n.name, nodeStatusWord(world, n.id), role, age(t, -86_400 * 40), "v1.30.4"]);
  }
  return pad(rows);
}

export function podsTable(world: WorldPort, clusterId: string, ns?: string): string {
  const t = world.time();
  const rows: string[][] = [["NAMESPACE", "NAME", "READY", "STATUS", "RESTARTS", "AGE", "NODE"]];
  for (const { w, p } of podEntries(world, clusterId)) {
    const space = k8sWorkloadDef(w).namespace;
    if (ns && ns !== space) continue;
    const words = podWords(world, p);
    const node = p.node ? (world.index.find(p.node)?.name ?? p.node) : "<none>";
    rows.push([
      space,
      p.name,
      words.ready,
      words.status,
      String(p.restarts),
      age(t, p.since),
      node,
    ]);
  }
  return rows.length === 1 ? "No resources found." : pad(rows);
}

export function workloadsTable(world: WorldPort, clusterId: string): string {
  const t = world.time();
  const rows: string[][] = [["NAMESPACE", "NAME", "READY", "UP-TO-DATE", "AVAILABLE", "AGE"]];
  for (const w of workloadsOfCluster(world.index, clusterId)) {
    const s = world.stateAs(w.id, "k8s_workload");
    const running = s.pods.filter((p) => p.phase === "Running").length;
    rows.push([
      k8sWorkloadDef(w).namespace,
      w.name,
      `${running}/${s.desired}`,
      String(running),
      String(running),
      age(t, -86_400 * 10),
    ]);
  }
  return pad(rows);
}

// ── describe ─────────────────────────────────────────────────────────────────────────────────

export function describeNode(world: WorldPort, node: Entity): string {
  const s = world.stateAs(node.id, "k8s_node");
  const cluster = clusterOfNode(world, node.id);
  const def = k8sNodeDef(node);
  const pods = cluster ? podEntries(world, cluster.id).filter((x) => x.p.node === node.id) : [];
  const held = pods.filter((x) => x.p.phase !== "Evicted");
  let cpu = 0;
  let mem = 0;
  for (const { w } of held) {
    cpu += k8sWorkloadDef(w).cpuMilli;
    mem += k8sWorkloadDef(w).memMiB;
  }
  const silent = !s.reachable;
  const cond = (type: string, bad: boolean, reason: string, ok: string) =>
    `  ${type.padEnd(16)}${bad ? "True " : "False"}   ${bad ? reason : ok}`;
  const lines = [
    `Name:               ${node.name}`,
    `Roles:              ${def.role}`,
    `Unschedulable:      ${s.unschedulable}`,
    "Conditions:",
    "  Type            Status  Reason",
    `  Ready           ${s.status === "Ready" ? "True " : silent ? "Unknown" : "False"}   ${s.status === "Ready" ? "KubeletReady" : "NodeStatusUnknown: Kubelet stopped posting node status."}`,
    cond("DiskPressure", s.diskPressure, "KubeletHasDiskPressure", "KubeletHasNoDiskPressure"),
    cond("MemoryPressure", false, "KubeletHasSufficientMemory", "KubeletHasSufficientMemory"),
    cond("PIDPressure", false, "KubeletHasSufficientPID", "KubeletHasSufficientPID"),
    ...(s.cniBroken
      ? [
          "  NetworkUnavailable  False  (cni plugin: failed to set up pod network; see containerd logs)",
        ]
      : []),
    ...(s.diskPressure || s.cordonedByPressure
      ? ["Taints:             node.kubernetes.io/disk-pressure:NoSchedule"]
      : s.status === "NotReady"
        ? ["Taints:             node.kubernetes.io/unreachable:NoExecute"]
        : ["Taints:             <none>"]),
    "Allocatable:",
    `  cpu:                ${s.allocCpuMilli}m`,
    `  memory:             ${s.allocMemMiB}Mi`,
    `Non-terminated Pods:  (${held.length} in total)`,
    ...held.map(
      (x) =>
        `  ${k8sWorkloadDef(x.w).namespace}  ${x.p.name}  ${k8sWorkloadDef(x.w).cpuMilli}m  ${k8sWorkloadDef(x.w).memMiB}Mi`,
    ),
    "Allocated resources:",
    `  cpu                ${cpu}m (${Math.round((cpu / Math.max(1, s.allocCpuMilli)) * 100)}%)`,
    `  memory             ${mem}Mi (${Math.round((mem / Math.max(1, s.allocMemMiB)) * 100)}%)`,
  ];
  return lines.join("\n");
}

const WAITING: Readonly<Record<string, string>> = {
  CrashLoopBackOff: "Waiting: CrashLoopBackOff (Back-off restarting failed container)",
  ImagePullBackOff: "Waiting: ImagePullBackOff (Back-off pulling image)",
  ContainerCreating: "Waiting: ContainerCreating",
  Pending: "Pending",
};

export function describePod(world: WorldPort, w: Entity, p: PodState, clusterId: string): string {
  const def = k8sWorkloadDef(w);
  const node = p.node ? (world.index.find(p.node)?.name ?? p.node) : "<none>";
  const nodes = nodesOfCluster(world.index, clusterId).filter(
    (n) => k8sNodeDef(n).role === "worker",
  );
  const events: string[] = [];
  if (p.phase === "Pending")
    events.push(
      `  Warning  FailedScheduling  0/${nodes.length} nodes are available: ${nodes.length} Insufficient cpu/memory (or node(s) unschedulable / had untolerated taint).`,
    );
  if (p.phase === "CrashLoopBackOff")
    events.push("  Warning  BackOff  Back-off restarting failed container");
  if (p.phase === "ImagePullBackOff")
    events.push(
      "  Warning  Failed  Failed to pull image: dial tcp: i/o timeout (registry unreachable)",
    );
  if (p.phase === "Evicted")
    events.push("  Warning  Evicted  The node was low on resource: ephemeral-storage.");
  return [
    `Name:             ${p.name}`,
    `Namespace:        ${def.namespace}`,
    `Node:             ${node}`,
    `Status:           ${p.phase === "Evicted" ? "Failed" : p.phase === "Running" ? "Running" : "Pending"}`,
    `Containers:`,
    `  ${w.name}:`,
    `    State:          ${p.phase === "Running" ? "Running" : (WAITING[p.phase] ?? p.phase)}`,
    `    Restart Count:  ${p.restarts}`,
    `    Requests:       cpu ${def.cpuMilli}m, memory ${def.memMiB}Mi`,
    "Events:",
    ...(events.length > 0 ? events : ["  <none>"]),
  ].join("\n");
}

// ── logs ──────────────────────────────────────────────────────────────────────────────────────

export function podLogs(world: WorldPort, w: Entity, p: PodState, tail: number): ShellOut {
  const fault = world.faultsOn(w.id).find((f) => f.type === "k8s_pod_crashloop");
  if (p.phase === "Pending" || p.phase === "ContainerCreating" || p.phase === "ImagePullBackOff")
    return {
      output: `Error from server (BadRequest): container "${w.name}" in pod "${p.name}" is waiting to start: ${p.phase === "ImagePullBackOff" ? "trying and failing to pull image" : "ContainerCreating"}`,
      exitCode: 1,
    };
  const stamp = (i: number) =>
    `2026-11-06T09:${String(10 + (i % 40)).padStart(2, "0")}:${String((i * 7) % 60).padStart(2, "0")}Z`;
  const crash = p.phase === "CrashLoopBackOff";
  const lines = crash
    ? (fault?.params.variant ?? 1) === 2
      ? [`exec /app/${w.name}: exec format error`]
      : [
          `${stamp(1)} INFO  starting ${w.name}`,
          `${stamp(2)} FATAL invalid configuration: required key 'UPSTREAM_URL' is not set`,
          `${stamp(3)} INFO  exiting with status 1`,
        ]
    : Array.from(
        { length: 40 },
        (_, i) => `${stamp(i)} INFO  ${w.name} handled request id=${1000 + i} status=200`,
      );
  return { output: lines.slice(-Math.max(1, tail)).join("\n"), exitCode: 0 };
}

// ── the shell ─────────────────────────────────────────────────────────────────────────────────

const NOT_YET: ShellOut = {
  output:
    "이 kubectl 명령은 아직 못 해요. 되는 것: kubectl get nodes|pods|deployments [-n <ns>], kubectl describe node <name>",
  exitCode: 1,
};

const ok = (output: string): ShellOut => ({ output, exitCode: 0 });

/** `kubectl get nodes|pods|deployments [-n ns]`. */
function kubectlGet(world: WorldPort, clusterId: string, argv: readonly string[]): ShellOut {
  const what = argv[2];
  const nsAt = argv.indexOf("-n");
  const ns = nsAt >= 0 ? argv[nsAt + 1] : undefined;
  if (what === "nodes" || what === "node") return ok(nodesTable(world, clusterId));
  if (what === "pods" || what === "pod") return ok(podsTable(world, clusterId, ns));
  if (what === "deployments" || what === "deploy") return ok(workloadsTable(world, clusterId));
  return NOT_YET;
}

/** `kubectl describe node <name>`. */
function kubectlDescribe(world: WorldPort, clusterId: string, argv: readonly string[]): ShellOut {
  const name = argv[3];
  if (argv[2] !== "node" || !name) return NOT_YET;
  const n = nodesOfCluster(world.index, clusterId).find((x) => x.name === name || x.id === name);
  return n
    ? ok(describeNode(world, n))
    : { output: `Error from server (NotFound): nodes "${name}" not found`, exitCode: 1 };
}

/** `kubectl get|describe …` on a host that is a node. */
export function kubectl(world: WorldPort, hostId: string, argv: readonly string[]): ShellOut {
  const node = nodeOnHost(world, hostId);
  const cluster = node ? clusterOfNode(world, node.id) : undefined;
  if (!cluster) return { output: "bash: kubectl: command not found", exitCode: 127 };
  if (!world.stateAs(cluster.id, "k8s_cluster").apiUp)
    return REFUSED(world.index.entity(hostId).name);
  if (argv[1] === "get") return kubectlGet(world, cluster.id, argv);
  return argv[1] === "describe" ? kubectlDescribe(world, cluster.id, argv) : NOT_YET;
}

/** `crictl ps` on a node: the containers of the pods that stand on it (what the runtime sees, API or not). */
export function crictl(world: WorldPort, hostId: string, argv: readonly string[]): ShellOut {
  const node = nodeOnHost(world, hostId);
  if (!node) return { output: "bash: crictl: command not found", exitCode: 127 };
  if (argv[1] !== "ps")
    return { output: "이 crictl 명령은 아직 못 해요. 되는 것: crictl ps", exitCode: 1 };
  const cluster = clusterOfNode(world, node.id);
  const t = world.time();
  const rows: string[][] = [["CONTAINER", "IMAGE", "CREATED", "STATE", "NAME", "POD"]];
  for (const { w, p } of cluster ? podEntries(world, cluster.id) : []) {
    if (p.node !== node.id || p.phase === "Evicted" || p.phase === "Pending") continue;
    const state =
      p.phase === "Running" ? "Running" : p.phase === "CrashLoopBackOff" ? "Exited" : "Created";
    rows.push([
      p.name.slice(-12).replace(/-/g, "a"),
      `registry.local/${w.name}:1.4.2`,
      `${age(t, p.since)} ago`,
      state,
      w.name,
      p.name.slice(0, 13),
    ]);
  }
  return { output: pad(rows), exitCode: 0 };
}
