/**
 * The tools of the container layer (REQ-096, ADR-0107 item 6): look at a cluster the way `kubectl` does, read a pod's
 * log, restart a rollout, scale a workload, cordon, drain and uncordon a node, delete a pod. Every one is a tool a
 * real platform team has (`common`) and belongs to the service/OS team (domains.ts). They live in a file of their own
 * and are added to the catalog at its end.
 */
import type { JsonSchema, ToolSpec } from "./catalog";
import type { ToolDoc } from "./docs";

type K8sSpec = Omit<ToolSpec, "realism" | "description" | "area">;

const obj = (properties: JsonSchema["properties"], required: string[] = []): JsonSchema => ({
  type: "object",
  properties,
  required,
});
const str = (description: string) => ({ type: "string", description });

export const K8S_SPECS: readonly K8sSpec[] = [
  {
    name: "kubectl_get",
    title: "쿠버네티스 목록 (kubectl get)",
    category: "observe",
    mutating: false,
    inputSchema: obj(
      {
        kind: {
          type: "string",
          enum: ["nodes", "pods", "deployments"],
          description: "What to list",
        },
        namespace: str("Only this namespace (pods)"),
        cluster: str("Kubernetes cluster id; omitted lists every cluster of the world"),
      },
      ["kind"],
    ),
  },
  {
    name: "kubectl_describe",
    title: "쿠버네티스 상세 (kubectl describe)",
    category: "observe",
    mutating: false,
    inputSchema: obj(
      {
        kind: {
          type: "string",
          enum: ["node", "pod", "deployment"],
          description: "What to describe",
        },
        name: str("Name or id of the node, pod or deployment"),
      },
      ["kind", "name"],
    ),
  },
  {
    name: "kubectl_logs",
    title: "파드 로그 (kubectl logs)",
    category: "observe",
    mutating: false,
    inputSchema: obj(
      { pod: str("Pod name"), tail: { type: "number", description: "Last N lines (default 20)" } },
      ["pod"],
    ),
  },
  {
    name: "kubectl_rollout_restart",
    title: "롤아웃 재시작",
    category: "act",
    mutating: true,
    inputSchema: obj({ workload: str("Deployment name or id") }, ["workload"]),
  },
  {
    name: "kubectl_scale",
    title: "레플리카 수 바꾸기",
    category: "act",
    mutating: true,
    inputSchema: obj(
      {
        workload: str("Deployment name or id"),
        replicas: { type: "number", description: "Replicas wanted (0-50)" },
      },
      ["workload", "replicas"],
    ),
  },
  {
    name: "kubectl_cordon",
    title: "노드 cordon",
    category: "act",
    mutating: true,
    inputSchema: obj({ node: str("Node name or id") }, ["node"]),
  },
  {
    name: "kubectl_uncordon",
    title: "노드 uncordon",
    category: "act",
    mutating: true,
    inputSchema: obj({ node: str("Node name or id") }, ["node"]),
  },
  {
    name: "kubectl_drain",
    title: "노드 drain",
    category: "act",
    mutating: true,
    inputSchema: obj({ node: str("Node name or id") }, ["node"]),
  },
  {
    name: "kubectl_delete_pod",
    title: "파드 지우기",
    category: "act",
    mutating: true,
    inputSchema: obj({ pod: str("Pod name") }, ["pod"]),
  },
];

const d = (doc: ToolDoc): ToolDoc => doc;

export const K8S_DOCS: Readonly<Record<string, ToolDoc>> = {
  kubectl_get: d({
    area: "observe",
    realism: "common",
    summary:
      "List the nodes, pods or deployments of a Kubernetes cluster as `kubectl get` shows them: status, ready count, restarts, the node a pod is on.",
    use: "a service that runs on Kubernetes is down or slow, or an alarm names a node or a workload, and you want to see which nodes are NotReady and which pods are not Running.",
    notUse:
      "you want the reason (use kubectl_describe or kubectl_logs) or the machine under a node (use run_command on its host).",
    example: '{"kind":"pods","namespace":"default"}',
    cost: "low",
    costWhy: "one list of objects, read once",
    details:
      "This is the API's view: a node is NotReady only after it has been silent for 40 seconds, a pod on it keeps saying Running until the cluster moves it (5 minutes by default), and a pod with a dead network plugin still says Running. When the control plane is down the call is refused.",
  }),
  kubectl_describe: d({
    area: "observe",
    realism: "common",
    summary:
      "Everything the API knows about one node, pod or deployment: conditions, taints, allocatable and requested resources, restart count, and the events that say why a pod waits.",
    use: "a node is NotReady or cordoned, a pod is Pending, CrashLoopBackOff or ImagePullBackOff, and you want the reason.",
    notUse: "you only want the list of what exists (use kubectl_get).",
    example: '{"kind":"pod","name":"orchestrator-7d9f8-x2k4p"}',
    cost: "low",
    costWhy: "one object",
  }),
  kubectl_logs: d({
    area: "observe",
    realism: "common",
    summary: "The last lines a pod's container wrote. A pod that is waiting to start has none.",
    use: "a pod restarts again and again (CrashLoopBackOff) and you want the error it dies with.",
    notUse: "the pod is Pending or ImagePullBackOff (it has not started: use kubectl_describe).",
    example: '{"pod":"orchestrator-7d9f8-x2k4p","tail":20}',
    cost: "low",
    costWhy: "a few lines",
  }),
  kubectl_rollout_restart: d({
    area: "act",
    realism: "common",
    summary:
      "Replace the pods of a deployment one by one with new ones that read the current image and configuration. A new pod is started before the old one goes.",
    use: "pods crash because of an image or configuration that has been fixed since, or a workload is stuck in a state a fresh pod would leave.",
    notUse:
      "the pods are fine, the cause is the node or the network (new pods go to the same trouble), or the control plane is down.",
    example: '{"workload":"orchestrator"}',
    cost: "medium",
    costWhy: "every pod of the workload is replaced, one after another",
  }),
  kubectl_scale: d({
    area: "act",
    realism: "common",
    summary:
      "Set how many replicas a deployment should have. More replicas need room on the nodes; fewer free it for others.",
    use: "pods are Pending because the cluster is full and a less important workload can give up room, or a workload needs more replicas.",
    notUse:
      "the pods are Pending for another reason (every node cordoned, a broken image); scaling a workload to 0 stops its service.",
    example: '{"workload":"report","replicas":0}',
    cost: "medium",
    costWhy: "one change that moves what the cluster has room for",
  }),
  kubectl_cordon: d({
    area: "act",
    realism: "common",
    summary: "Mark a node unschedulable: no new pod comes to it, the pods that run there stay.",
    use: "a node is suspect and you do not want more pods on it before you look.",
    notUse: "you want the pods gone too (use kubectl_drain).",
    example: '{"node":"iap-worker-3"}',
    cost: "low",
    costWhy: "one flag on the node object",
  }),
  kubectl_uncordon: d({
    area: "act",
    realism: "common",
    summary: "Let a cordoned node take new pods again.",
    use: "the reason for the cordon is gone (the disk was cleaned, the node was repaired) and pods wait for room.",
    notUse: "the node is still NotReady or short of disk: pods sent there would not run.",
    example: '{"node":"iap-worker-3"}',
    cost: "low",
    costWhy: "one flag on the node object",
  }),
  kubectl_drain: d({
    area: "act",
    realism: "common",
    summary:
      "Cordon a node and send all its pods away; their workloads make replacements on other nodes. Pods that find no room stay Pending.",
    use: "you must work on a node (a host to repair, a network plugin that is dead) and its pods should run elsewhere first.",
    notUse:
      "the other nodes have no room for these pods (they would be Pending), or the node is already gone (the cluster moves its pods after 5 minutes).",
    example: '{"node":"iap-worker-3"}',
    cost: "medium",
    costWhy: "every pod of the node restarts elsewhere",
  }),
  kubectl_delete_pod: d({
    area: "act",
    realism: "common",
    summary: "Delete one pod; its workload makes a new one at once, placed by the scheduler.",
    use: "one pod is stuck or Evicted and a fresh one would be fine, or you want a pod to land on another node.",
    notUse:
      "all pods of the workload crash (a new pod crashes too: use kubectl_rollout_restart after the cause is fixed).",
    example: '{"pod":"orchestrator-7d9f8-x2k4p"}',
    cost: "low",
    costWhy: "one pod is deleted and replaced",
  }),
};
