/**
 * The handlers of the container-layer tools (REQ-096): they read the state the physics keeps and give a command to the
 * world. `kubectl_get` answers as the API does and says a table the way `kubectl` prints it; the actions say plainly
 * what the cluster will do next (a drain sends pods away, a rollout replaces them one at a time).
 */
import { ConflictError, InvalidValueError } from "@terrarium/core/kernel";
import {
  type Entity,
  k8sNodeDef,
  k8sWorkloadDef,
  livePods,
  nodesOfCluster,
  type WorldPort,
  workloadOfPod,
  workloadsOfCluster,
} from "@terrarium/core/world";
import type { Args, ToolContext } from "./handlers";
import {
  clusterOfNode,
  describeNode,
  describePod,
  nodeStatusWord,
  nodesTable,
  podEntries,
  podLogs,
  podsTable,
  podWords,
  workloadsTable,
} from "./shell-k8s";

type Handler = (ctx: ToolContext, args: Args) => unknown;

const str = (args: Args, key: string): string => String(args[key] ?? "");

const REFUSED =
  "The connection to the server was refused - did you specify the right host or port? (컨트롤 플레인이 멈춰 있어요)";

function clustersOf(world: WorldPort, id: string | undefined): Entity[] {
  if (id) {
    const e = world.index.entity(id);
    if (e.kind !== "k8s_cluster")
      throw new InvalidValueError(`'${id}'는 쿠버네티스 클러스터가 아니에요`);
    return [e];
  }
  const all = [...world.index.ofKind("k8s_cluster")].sort((a, b) => a.id.localeCompare(b.id));
  if (all.length === 0) throw new InvalidValueError("이 세계에는 쿠버네티스 클러스터가 없어요");
  return all;
}

const needApi = (world: WorldPort, cluster: Entity): void => {
  if (!world.stateAs(cluster.id, "k8s_cluster").apiUp) throw new ConflictError(REFUSED);
};

/** An entity of this kind named by id or by name (the first by id when a name is shared). */
function named(world: WorldPort, kind: Entity["kind"], name: string): Entity {
  const list = world.index.ofKind(kind);
  const hit = list.find((e) => e.id === name) ?? list.find((e) => e.name === name);
  if (!hit)
    throw new InvalidValueError(
      `'${name}'라는 ${kind === "k8s_node" ? "노드" : "워크로드"}는 없어요`,
    );
  return hit;
}

const apiView = (world: WorldPort, cluster: Entity) => {
  const s = world.stateAs(cluster.id, "k8s_cluster");
  return { cluster: cluster.id, name: cluster.name, apiUp: s.apiUp };
};

const kubectlGet: Handler = (ctx, args) => {
  const { world } = ctx;
  const kind = str(args, "kind");
  const ns = args.namespace === undefined ? undefined : str(args, "namespace");
  const clusters = clustersOf(world, args.cluster === undefined ? undefined : str(args, "cluster"));
  return {
    clusters: clusters.map((c) => {
      needApi(world, c);
      if (kind === "nodes")
        return {
          ...apiView(world, c),
          output: nodesTable(world, c.id),
          items: nodesOfCluster(world.index, c.id).map((n) => ({
            id: n.id,
            name: n.name,
            status: nodeStatusWord(world, n.id),
            role: k8sNodeDef(n).role,
          })),
        };
      if (kind === "deployments")
        return {
          ...apiView(world, c),
          output: workloadsTable(world, c.id),
          items: workloadsOfCluster(world.index, c.id).map((w) => ({
            id: w.id,
            name: w.name,
            desired: world.stateAs(w.id, "k8s_workload").desired,
          })),
        };
      if (kind !== "pods")
        throw new InvalidValueError("kind는 nodes, pods, deployments 중 하나예요");
      return {
        ...apiView(world, c),
        output: podsTable(world, c.id, ns),
        items: podEntries(world, c.id)
          .filter(({ w }) => !ns || k8sWorkloadDef(w).namespace === ns)
          .map(({ w, p }) => ({
            name: p.name,
            deployment: w.name,
            ...podWords(world, p),
            restarts: p.restarts,
            node: p.node ? (world.index.find(p.node)?.name ?? p.node) : null,
          })),
      };
    }),
  };
};

function podNamed(world: WorldPort, name: string) {
  const id = workloadOfPod(world, name);
  if (!id) throw new InvalidValueError(`'${name}' 파드는 없어요`);
  const w = world.index.entity(id);
  const p = world.stateAs(id, "k8s_workload").pods.find((x) => x.name === name);
  if (!p) throw new InvalidValueError(`'${name}' 파드는 없어요`);
  return { w, p };
}

const kubectlDescribe: Handler = (ctx, args) => {
  const { world } = ctx;
  const kind = str(args, "kind");
  const name = str(args, "name");
  if (kind === "node") {
    const n = named(world, "k8s_node", name);
    const c = clusterOfNode(world, n.id);
    if (c) needApi(world, c);
    return { output: describeNode(world, n) };
  }
  if (kind === "pod") {
    const { w, p } = podNamed(world, name);
    const c = world.index.outgoing(w.id, "member_of")[0]?.to;
    if (c) needApi(world, world.index.entity(c));
    return { output: describePod(world, w, p, c ?? "") };
  }
  if (kind !== "deployment")
    throw new InvalidValueError("kind는 node, pod, deployment 중 하나예요");
  const w = named(world, "k8s_workload", name);
  const s = world.stateAs(w.id, "k8s_workload");
  const def = k8sWorkloadDef(w);
  return {
    output: [
      `Name:        ${w.name}`,
      `Namespace:   ${def.namespace}`,
      `Replicas:    ${s.desired} desired | ${livePods(s).length} total | ${s.pods.filter((p) => p.phase === "Running").length} available`,
      `Requests:    cpu ${def.cpuMilli}m, memory ${def.memMiB}Mi per pod`,
      `Revision:    ${s.gen}${s.rollQueue ? " (rolling out)" : ""}`,
    ].join("\n"),
  };
};

const kubectlLogs: Handler = (ctx, args) => {
  const { w, p } = podNamed(ctx.world, str(args, "pod"));
  const c = ctx.world.index.outgoing(w.id, "member_of")[0]?.to;
  if (c) needApi(ctx.world, ctx.world.index.entity(c));
  const tail = typeof args.tail === "number" ? args.tail : 20;
  const r = podLogs(ctx.world, w, p, tail);
  if (r.exitCode !== 0) throw new ConflictError(r.output);
  return { pod: p.name, output: r.output };
};

const rolloutRestart: Handler = (ctx, args) => {
  const w = named(ctx.world, "k8s_workload", str(args, "workload"));
  ctx.world.apply({ type: "k8s.rollout_restart", target: w.id }, "tool:kubectl_rollout_restart");
  const s = ctx.world.stateAs(w.id, "k8s_workload");
  return {
    workload: w.name,
    revision: s.gen,
    note: `파드 ${s.rollQueue?.length ?? 0}개를 하나씩 새 것으로 바꿔요. 새 파드가 뜬 뒤에 옛 파드를 지워요. kubectl_get으로 지켜보세요.`,
  };
};

const scale: Handler = (ctx, args) => {
  const w = named(ctx.world, "k8s_workload", str(args, "workload"));
  const replicas = Number(args.replicas);
  const before = ctx.world.stateAs(w.id, "k8s_workload").desired;
  ctx.world.apply({ type: "k8s.scale", target: w.id, replicas }, "tool:kubectl_scale");
  return {
    workload: w.name,
    from: before,
    to: replicas,
    note: "클러스터가 파드를 맞춰 만들거나 지워요.",
  };
};

function nodeAction(type: "cordon" | "uncordon" | "drain"): Handler {
  return (ctx, args) => {
    const n = named(ctx.world, "k8s_node", str(args, "node"));
    const tool = `tool:kubectl_${type}`;
    if (type === "drain") ctx.world.apply({ type: "k8s.drain", target: n.id }, tool);
    else ctx.world.apply({ type: "k8s.cordon", target: n.id, on: type === "cordon" }, tool);
    return {
      node: n.name,
      status: nodeStatusWord(ctx.world, n.id),
      note:
        type === "drain"
          ? "노드를 막고 파드를 내보냈어요. 다른 노드에 자리가 없으면 Pending으로 남아요."
          : type === "cordon"
            ? "이 노드에는 새 파드가 오지 않아요. 돌던 파드는 그대로예요."
            : "이 노드가 다시 새 파드를 받아요.",
    };
  };
}

const deletePod: Handler = (ctx, args) => {
  const { w, p } = podNamed(ctx.world, str(args, "pod"));
  ctx.world.apply({ type: "k8s.delete_pod", target: w.id, pod: p.name }, "tool:kubectl_delete_pod");
  return { deleted: p.name, deployment: w.name, note: "워크로드가 새 파드를 만들어요." };
};

export const K8S_HANDLERS: Readonly<Record<string, Handler>> = {
  kubectl_get: kubectlGet,
  kubectl_describe: kubectlDescribe,
  kubectl_logs: kubectlLogs,
  kubectl_rollout_restart: rolloutRestart,
  kubectl_scale: scale,
  kubectl_cordon: nodeAction("cordon"),
  kubectl_uncordon: nodeAction("uncordon"),
  kubectl_drain: nodeAction("drain"),
  kubectl_delete_pod: deletePod,
};
