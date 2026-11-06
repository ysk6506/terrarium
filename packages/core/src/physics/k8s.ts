/**
 * Clusters move with time and with the faults on them (REQ-096, ADR-0107 item 6): a node whose machine stops is
 * NotReady after the grace period and loses its pods to other nodes after the eviction timeout; a pod that crashes
 * waits longer each time; a node short of disk throws its pods out; a workload that is missing pods gets them back and
 * the scheduler places the ones that wait. What the cluster does by itself is a world event with the cause `cluster`
 * (the same cause the database uses), so scoring can tell a recovery the cluster made from one the agent made.
 *
 * Each step: nodes first (what the machine under them does), then the control plane (is the API up), then the node
 * status the API shows, then workloads (pods start, crash, are replaced, are placed). Services read the result in the
 * same step (services.ts).
 */
import {
  BACKOFF_FIRST_S,
  BACKOFF_MAX_S,
  bindPending,
  clusterOfK8s,
  controlPlaneOf,
  DISK_PRESSURE_PCT,
  type Entity,
  EVICTED_KEEP_S,
  hostVerdict,
  k8sClusterDef,
  k8sNodeDef,
  line,
  logTo,
  NODE_GRACE_S,
  type NodeRef,
  newPod,
  nodeHost,
  nodesOfCluster,
  POD_START_S,
  type PodState,
  type StateOf,
  serviceDef,
  type WorkloadRef,
  type World,
  type WorldEvent,
  workersOf,
  workloadsOfCluster,
  workloadsOfService,
  workloadVerdict,
} from "@terrarium/core/world";
import { CLUSTER_CAUSE } from "./db";

const PROBE = serviceDef({ id: "probe", kind: "service", name: "probe", props: {} });
const CAUSE = "physics";
/** Disk use a disk-pressure fault puts on the node's machine, %. */
const FILL_PCT = 92;

const has = (world: World, id: string, type: string): boolean =>
  world.faultsOn(id).some((f) => f.type === type);

function healed(world: World, events: WorldEvent[], text: string): void {
  events.push(world.apply({ type: "note", text }, CLUSTER_CAUSE));
}

// ── nodes ──────────────────────────────────────────────────────────────────────────────────

/** Whether the machine under a node works, and the kubelet on it. */
function machineWorks(world: World, node: Entity): boolean {
  // a control-plane fault on a worker means its node agent is down: the node is silent either way
  if (
    world
      .faultsOn(node.id)
      .some((f) => f.type === "k8s_node_notready" || f.type === "k8s_control_plane_down")
  )
    return false;
  const host = nodeHost(world.index, node.id);
  return host ? hostVerdict(world, host, PROBE).state !== "dead" : true;
}

function markKubelet(world: World, node: Entity, working: boolean): void {
  const host = nodeHost(world.index, node.id);
  if (!host) return;
  const existing = (world.stateOf(host) as StateOf<"vm"> | StateOf<"server">).os;
  const os = existing ?? (working ? undefined : world.ensureHostOs(host));
  const p = os?.processes.find((q) => q.name === "kubelet");
  if (!p) return;
  if (!working && p.state === "running") p.state = "failed";
  else if (working && p.state === "failed") p.state = "running";
}

/** The disk of the machine: the fault fills it once, and cleaning it ends the fault. */
function diskOf(world: World, node: Entity, events: WorldEvent[]): number {
  const s = world.stateAs(node.id, "k8s_node");
  const host = nodeHost(world.index, node.id);
  const fault = world.faultsOn(node.id).find((f) => f.type === "k8s_disk_pressure");
  if (!host) return fault ? FILL_PCT : 0;
  if (fault && !s.fillDone) {
    const os = world.ensureHostOs(host);
    os.diskPct = Math.max(os.diskPct, FILL_PCT);
    logTo(
      os,
      line(
        world.time(),
        "kubelet",
        "warn",
        "eviction manager: attempting to reclaim ephemeral-storage",
      ),
    );
    s.fillDone = true;
  }
  const os = (world.stateOf(host) as StateOf<"vm"> | StateOf<"server">).os;
  const pct = os?.diskPct ?? 0;
  if (fault && s.fillDone && pct < DISK_PRESSURE_PCT) {
    events.push(world.apply({ type: "fault.remove", faultId: fault.id }, CAUSE));
    s.fillDone = false;
  }
  if (!fault) s.fillDone = false;
  return pct;
}

function updateNode(world: World, node: Entity, lostPct: number, events: WorldEvent[]): void {
  const s = world.stateAs(node.id, "k8s_node");
  const def = k8sNodeDef(node);
  const works = machineWorks(world, node);
  s.reachable = works;
  markKubelet(world, node, works);
  s.cniBroken = has(world, node.id, "k8s_cni_failure");
  s.diskPressure = diskOf(world, node, events) >= DISK_PRESSURE_PCT;
  const keep = def.role === "worker" ? (100 - lostPct) / 100 : 1;
  s.allocCpuMilli = Math.round(def.cpuMilli * keep);
  s.allocMemMiB = Math.round(def.memMiB * keep);
}

// ── control plane ──────────────────────────────────────────────────────────────────────────

function updateControlPlane(world: World, cluster: Entity): void {
  const s = world.stateAs(cluster.id, "k8s_cluster");
  const cp = controlPlaneOf(world.index, cluster.id);
  const up = cp.filter((n) => world.stateAs(n.id, "k8s_node").reachable).length;
  s.cpTotal = cp.length;
  s.cpUp = up;
  const etcdFault = world.faultsOn(cluster.id).find((f) => f.type === "k8s_etcd_quorum_lost");
  s.etcdTotal = cp.length;
  s.etcdUp = Math.max(0, up - (etcdFault ? (etcdFault.params.down ?? 2) : 0));
  s.quorum = cp.length === 0 || s.etcdUp >= Math.floor(cp.length / 2) + 1;
  s.apiUp = cp.length === 0 || (up >= 1 && s.quorum);
  if (s.apiUp) delete s.why;
  else
    s.why = !s.quorum
      ? `etcd 멤버 ${s.etcdUp}/${s.etcdTotal}개 — 쿼럼이 없어 API가 쓰기를 못 받아요`
      : "컨트롤 플레인 노드가 모두 멈춰 API가 답하지 않아요";
}

/** What the API shows of a node: NotReady once the machine has been silent for the grace period. */
function updateStatus(world: World, node: Entity, now: number, apiUp: boolean): void {
  const s = world.stateAs(node.id, "k8s_node");
  if (s.reachable) {
    delete s.notReadySince;
    if (apiUp) s.status = "Ready";
  } else {
    s.notReadySince ??= now;
    if (apiUp && now - s.notReadySince >= NODE_GRACE_S) s.status = "NotReady";
  }
  const why = nodeWhy(s);
  if (why) s.why = why;
  else delete s.why;
  s.health = nodeHealth(s);
}

/** Why a node is not well, in one sentence; undefined while it is. */
function nodeWhy(s: StateOf<"k8s_node">): string | undefined {
  if (!s.reachable) return "kubelet이 응답하지 않아요";
  if (s.diskPressure) return "디스크 압박(DiskPressure)";
  return s.cniBroken ? "네트워크 플러그인이 죽어 있어요" : undefined;
}

function nodeHealth(s: StateOf<"k8s_node">): "ok" | "warning" | "critical" {
  if (s.status === "NotReady") return "critical";
  return s.diskPressure || s.unschedulable || s.cniBroken ? "warning" : "ok";
}

// ── pods ───────────────────────────────────────────────────────────────────────────────────

const backoff = (restarts: number): number =>
  Math.min(BACKOFF_MAX_S, BACKOFF_FIRST_S * 2 ** Math.max(0, restarts - 1));

function crash(p: PodState, now: number): void {
  p.restarts += 1;
  p.phase = "CrashLoopBackOff";
  p.backoffUntil = now + backoff(p.restarts);
  p.reason = "Error";
}

/** Containers start, crash and back off, whatever the API is doing (this is the kubelet's work). */
function stepPod(
  world: World,
  p: PodState,
  crashing: boolean,
  pullBroken: boolean,
  now: number,
): void {
  const node = p.node ? world.stateAs(p.node, "k8s_node") : undefined;
  if (node && !node.reachable) return;
  if (p.phase === "ContainerCreating") startPod(p, crashing, pullBroken, now);
  else if (p.phase === "ImagePullBackOff" && !pullBroken) {
    p.phase = "ContainerCreating";
    p.startsAt = now + POD_START_S;
  } else if (p.phase === "CrashLoopBackOff") tryAgain(p, crashing, now);
  else if (p.phase === "Running" && crashing) crash(p, now);
}

/** The image is there (or is not) and the container starts (or dies at once). */
function startPod(p: PodState, crashing: boolean, pullBroken: boolean, now: number): void {
  if (p.startsAt === undefined || now < p.startsAt) return;
  if (pullBroken) {
    p.phase = "ImagePullBackOff";
    p.reason = "ErrImagePull";
    p.backoffUntil = now + 30;
  } else if (crashing) crash(p, now);
  else {
    p.phase = "Running";
    delete p.startsAt;
    delete p.reason;
  }
}

/** The back-off is over: the container is tried again, and runs if the cause is gone. */
function tryAgain(p: PodState, crashing: boolean, now: number): void {
  if (p.backoffUntil === undefined || now < p.backoffUntil) return;
  if (crashing) crash(p, now);
  else {
    p.phase = "Running";
    delete p.backoffUntil;
    delete p.reason;
  }
}

/** Pods a NotReady node has held for the eviction timeout are given up: the workloads make them again elsewhere. */
function evictFromDeadNodes(
  world: World,
  cluster: Entity,
  list: readonly WorkloadRef[],
  now: number,
  events: WorldEvent[],
): void {
  const def = k8sClusterDef(cluster);
  const cs = world.stateAs(cluster.id, "k8s_cluster");
  for (const node of workersOf(world.index, cluster.id)) {
    const s = world.stateAs(node.id, "k8s_node");
    if (s.status !== "NotReady" || s.notReadySince === undefined) continue;
    if (now - s.notReadySince < def.evictionS) continue;
    let moved = 0;
    for (const w of list) {
      const before = w.s.pods.length;
      w.s.pods = w.s.pods.filter((p) => p.node !== node.id || p.phase === "Evicted");
      moved += before - w.s.pods.length;
    }
    if (moved === 0) continue;
    cs.reschedules += moved;
    healed(
      world,
      events,
      `${cluster.name}: ${node.name}가 ${Math.round(def.evictionS / 60)}분째 NotReady라 파드 ${moved}개를 다른 노드로 옮기도록 했어요`,
    );
  }
}

/** A node short of disk sends its pods away and is cordoned until an operator says it may take pods again. */
function evictForPressure(
  world: World,
  cluster: Entity,
  list: readonly WorkloadRef[],
  now: number,
  events: WorldEvent[],
): void {
  for (const node of workersOf(world.index, cluster.id)) {
    const s = world.stateAs(node.id, "k8s_node");
    if (!s.diskPressure) s.pressureSeen = false;
    if (!s.diskPressure || s.pressureSeen || !s.reachable) continue;
    s.pressureSeen = true;
    s.cordonedByPressure = true;
    s.unschedulable = true;
    let n = 0;
    for (const w of list)
      for (const p of w.s.pods)
        if (p.node === node.id && p.phase !== "Evicted") {
          p.phase = "Evicted";
          p.reason = "Evicted";
          p.goneAt = now + EVICTED_KEEP_S;
          n += 1;
        }
    if (n > 0)
      healed(
        world,
        events,
        `${cluster.name}: ${node.name}의 디스크가 모자라 kubelet이 파드 ${n}개를 쫓아냈어요`,
      );
  }
}

function keepReplicas(w: WorkloadRef, now: number): void {
  const base = w.s.pods.filter((p) => p.phase !== "Evicted" && p.replaces === undefined);
  for (let i = base.length; i < w.s.desired; i++) w.s.pods.push(newPod(w, now));
  if (base.length > w.s.desired) {
    const rank = (p: PodState) => (p.phase === "Running" ? 1 : 0);
    const drop = [...base]
      .sort((a, b) => rank(a) - rank(b) || b.since - a.since || b.name.localeCompare(a.name))
      .slice(0, base.length - w.s.desired);
    w.s.pods = w.s.pods.filter((p) => !drop.includes(p));
  }
}

/** A rollout restart: start the new pod beside the old one, and remove the old one once the new one runs. */
function stepRollout(w: WorkloadRef, now: number): void {
  for (const p of [...w.s.pods]) {
    if (p.replaces === undefined || p.phase !== "Running") continue;
    w.s.pods = w.s.pods.filter((q) => q.name !== p.replaces);
    delete p.replaces;
  }
  const queue = w.s.rollQueue;
  if (!queue || w.s.pods.some((p) => p.replaces !== undefined)) return;
  while (queue.length > 0) {
    const old = queue.shift() as string;
    if (!w.s.pods.some((p) => p.name === old && p.phase !== "Evicted")) continue;
    const fresh = newPod(w, now);
    fresh.replaces = old;
    w.s.pods.push(fresh);
    break;
  }
  if (queue.length === 0) delete w.s.rollQueue;
}

function updateWorkloads(world: World, cluster: Entity, now: number, events: WorldEvent[]): void {
  const cs = world.stateAs(cluster.id, "k8s_cluster");
  const list: WorkloadRef[] = workloadsOfCluster(world.index, cluster.id).map((entity) => ({
    entity,
    s: world.stateAs(entity.id, "k8s_workload"),
  }));
  const nodes: NodeRef[] = workersOf(world.index, cluster.id).map((n) => ({
    id: n.id,
    s: world.stateAs(n.id, "k8s_node"),
  }));
  const pullBroken = has(world, cluster.id, "k8s_image_pull_failure");
  for (const w of list) {
    const crashing = has(world, w.entity.id, "k8s_pod_crashloop");
    for (const p of w.s.pods) stepPod(world, p, crashing, pullBroken, now);
    w.s.pods = w.s.pods.filter((p) => p.phase !== "Evicted" || (p.goneAt ?? 0) > now);
  }
  evictForPressure(world, cluster, list, now, events);
  if (cs.apiUp) {
    evictFromDeadNodes(world, cluster, list, now, events);
    for (const w of list) {
      keepReplicas(w, now);
      stepRollout(w, now);
    }
    bindPending(nodes, list, now, POD_START_S);
  }
  for (const w of list) {
    const bad = w.s.pods.filter((p) => p.phase !== "Running" && p.phase !== "Evicted").length;
    w.s.health =
      bad === 0 ? "ok" : workloadVerdict(world, w.entity).state === "dead" ? "critical" : "warning";
  }
}

/** A service backed by workloads in two clusters keeps answering from the one that stands; the cluster says so once. */
function trafficShifts(world: World, events: WorldEvent[]): void {
  const dead = new Map<string, boolean>();
  for (const svc of world.index.ofKind("service")) {
    const ws = workloadsOfService(world.index, svc.id);
    if (ws.length < 2) continue;
    const verdicts = ws.map((w) => ({ w, dead: workloadVerdict(world, w).state === "dead" }));
    const alive = verdicts.some((v) => !v.dead);
    for (const v of verdicts) {
      const c = clusterOfK8s(world.index, v.w.id);
      if (c) dead.set(c.id, (dead.get(c.id) ?? false) || (v.dead && alive));
    }
  }
  for (const [id, shifted] of dead) {
    const cs = world.stateAs(id, "k8s_cluster");
    if (shifted && !cs.shifted)
      healed(
        world,
        events,
        `${world.index.entity(id).name}가 멈춰 서비스의 트래픽을 다른 클러스터로 돌렸어요`,
      );
    cs.shifted = shifted;
  }
}

/** Step every cluster of the world. Events: what the cluster does by itself (cause `cluster`). */
export function updateK8s(world: World): WorldEvent[] {
  const events: WorldEvent[] = [];
  const clusters = world.index.ofKind("k8s_cluster");
  if (clusters.length === 0) return events;
  const now = world.time();
  for (const cluster of [...clusters].sort((a, b) => a.id.localeCompare(b.id))) {
    const fault = world.faultsOn(cluster.id).find((f) => f.type === "k8s_resource_exhausted");
    const lost = fault ? (fault.params.lostPct ?? 50) : 0;
    const nodes = nodesOfCluster(world.index, cluster.id);
    for (const n of nodes) updateNode(world, n, lost, events);
    updateControlPlane(world, cluster);
    const api = world.stateAs(cluster.id, "k8s_cluster").apiUp;
    for (const n of nodes) updateStatus(world, n, now, api);
    updateWorkloads(world, cluster, now, events);
    const cs = world.stateAs(cluster.id, "k8s_cluster");
    cs.health = !cs.apiUp ? "critical" : cs.cpUp < cs.cpTotal ? "warning" : "ok";
  }
  trafficShifts(world, events);
  return events;
}
