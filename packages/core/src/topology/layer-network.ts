/**
 * The network and virtualisation layer: core and spine switches → switches on top of racks (ToR) → servers and
 * storage → virtual machines and clusters. A switch is a ToR when servers or storage are cabled to it; the
 * switches above are told apart by how many steps they are from a ToR. A world with no virtual machines ends at
 * the servers, because a stage with nothing in it is not drawn.
 */
import { type BlueprintIndex, breakerEnds, type Link } from "@terrarium/core/world";
import { type LayerShape, ShapeBuilder } from "./shape";

export const NETWORK_STAGES = [
  { id: "service", label: "서비스" },
  { id: "callee", label: "호출받는 서비스" },
  { id: "callee2", label: "그 아래 서비스" },
  { id: "front", label: "로드 밸런서·세션·메시" },
  { id: "region", label: "리전" },
  { id: "sidecar", label: "사이드카" },
  { id: "replica", label: "앱 인스턴스" },
  { id: "workload", label: "워크로드·파드" },
  { id: "workload2", label: "호출받는 워크로드" },
  { id: "cluster", label: "쿠버네티스 클러스터" },
  { id: "knode", label: "쿠버네티스 노드" },
  { id: "database", label: "데이터베이스" },
  { id: "instance", label: "DB 인스턴스" },
  { id: "pool", label: "스토리지 풀·컨트롤러" },
  { id: "door", label: "인그레스·정책·CNI" },
  { id: "segment", label: "오버레이 세그먼트" },
  { id: "controller", label: "SDN 컨트롤러" },
  { id: "vtep", label: "VTEP" },
  { id: "core", label: "코어 스위치" },
  { id: "spine", label: "스파인 스위치" },
  { id: "tor", label: "ToR 스위치" },
  { id: "host", label: "서버·스토리지" },
  { id: "virtual", label: "VM·클러스터" },
] as const;

const SERVICE = 0;
const CALLEE = 1;
const CALLEE2 = 2;
const FRONT = 3;
const REGION = 4;
const SIDECAR = 5;
const REPLICA = 6;
const WORKLOAD = 7;
const WORKLOAD2 = 8;
const CLUSTER = 9;
const KNODE = 10;
const DATABASE = 11;
const INSTANCE = 12;
const POOL = 13;
const DOOR = 14;
const SEGMENT = 15;
const CONTROLLER = 16;
const VTEP = 17;
const CORE = 18;
const SPINE = 19;
const TOR = 20;
const HOST = 21;
const VIRTUAL = 22;

/** Steps from a switch down to the nearest ToR: 0 for a ToR (or a switch nothing leans on), then 1, 2... */
function depthsOf(index: BlueprintIndex): Map<string, number> {
  const depths = new Map<string, number>();
  const visiting = new Set<string>();
  const depth = (id: string): number => {
    const known = depths.get(id);
    if (known !== undefined) return known;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const below = index
      .incoming(id, "network")
      .map((l) => index.find(l.from))
      .filter((e) => e !== undefined);
    let found = 0;
    if (!below.some((e) => e.kind === "server" || e.kind === "storage"))
      for (const e of below) if (e.kind === "switch") found = Math.max(found, 1 + depth(e.id));
    visiting.delete(id);
    depths.set(id, found);
    return found;
  };
  for (const sw of index.ofKind("switch")) depth(sw.id);
  return depths;
}

function addEquipment(index: BlueprintIndex, b: ShapeBuilder): void {
  for (const [id, d] of depthsOf(index))
    b.add(id, d === 0 ? TOR : d === 1 ? SPINE : CORE, "switch");
  for (const e of index.ofKind("server")) b.add(e.id, HOST, "server");
  for (const e of index.ofKind("storage")) b.add(e.id, HOST, "storage");
  for (const e of index.ofKind("vm")) b.add(e.id, VIRTUAL, "vm");
  for (const e of index.ofKind("cluster")) b.add(e.id, VIRTUAL, "cluster");
  const depth = callDepths(index);
  for (const e of index.ofKind("service"))
    b.add(e.id, [SERVICE, CALLEE, CALLEE2][depth.get(e.id) ?? 0] as number, "service");
  addApp(index, b);
  addDatabase(index, b);
  addContainers(index, b);
  addOverlay(index, b);
}

/**
 * How many calls deep each service or workload is: 0 when nothing calls it, then one more than the deepest of its callers
 * (two at most, because the board has two columns for callees). A link is drawn only from one column to a later one, so a
 * callee has to stand to the right of its callers.
 */
function callDepths(index: BlueprintIndex): Map<string, number> {
  const depths = new Map<string, number>();
  const visiting = new Set<string>();
  const depth = (id: string): number => {
    const known = depths.get(id);
    if (known !== undefined) return known;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    let found = 0;
    for (const l of index.incoming(id, "calls")) found = Math.max(found, 1 + depth(l.from));
    visiting.delete(id);
    depths.set(id, Math.min(2, found));
    return Math.min(2, found);
  };
  for (const e of [...index.ofKind("service"), ...index.ofKind("k8s_workload")]) depth(e.id);
  return depths;
}

/** The application stages (REQ-100): what stands in front of a service, its replicas, sidecars and regions. */
function addApp(index: BlueprintIndex, b: ShapeBuilder): void {
  for (const e of index.ofKind("load_balancer")) b.add(e.id, FRONT, "load_balancer");
  for (const e of index.ofKind("session_store")) b.add(e.id, FRONT, "session_store");
  for (const e of index.ofKind("mesh_control")) b.add(e.id, FRONT, "mesh_control");
  for (const e of index.ofKind("circuit_breaker")) b.add(e.id, FRONT, "circuit_breaker");
  for (const e of index.ofKind("region")) b.add(e.id, REGION, "region");
  for (const e of index.ofKind("mesh_sidecar")) b.add(e.id, SIDECAR, "mesh_sidecar");
  for (const e of index.ofKind("app_instance")) b.add(e.id, REPLICA, "app_instance");
}

/** The container stages next to the services (REQ-096): workloads with their pods, the clusters, their nodes. */
function addContainers(index: BlueprintIndex, b: ShapeBuilder): void {
  const depth = callDepths(index);
  for (const e of index.ofKind("k8s_workload"))
    b.add(e.id, (depth.get(e.id) ?? 0) > 0 ? WORKLOAD2 : WORKLOAD, "k8s_workload");
  for (const e of index.ofKind("k8s_cluster")) b.add(e.id, CLUSTER, "k8s_cluster");
  for (const e of index.ofKind("k8s_node")) b.add(e.id, KNODE, "k8s_node");
}

/** The overlay and cloud-native stages next to the switches (REQ-097): controllers, VTEPs, segments, doors. */
function addOverlay(index: BlueprintIndex, b: ShapeBuilder): void {
  for (const e of index.ofKind("sdn_controller")) b.add(e.id, CONTROLLER, "sdn_controller");
  for (const e of index.ofKind("vtep")) b.add(e.id, VTEP, "vtep");
  for (const e of index.ofKind("overlay_segment")) b.add(e.id, SEGMENT, "overlay_segment");
  for (const e of index.ofKind("nfv_function")) b.add(e.id, SEGMENT, "nfv_function");
  for (const e of index.ofKind("ingress")) b.add(e.id, DOOR, "ingress");
  for (const e of index.ofKind("network_policy")) b.add(e.id, DOOR, "network_policy");
  for (const e of index.ofKind("cni")) b.add(e.id, DOOR, "cni");
}

/** The database and storage-HA stages next to the services (REQ-095). */
function addDatabase(index: BlueprintIndex, b: ShapeBuilder): void {
  for (const e of index.ofKind("db_cluster")) b.add(e.id, DATABASE, "db_cluster");
  for (const e of index.ofKind("db_instance")) b.add(e.id, INSTANCE, "db_instance");
  for (const e of index.ofKind("storage_pool")) b.add(e.id, POOL, "storage_pool");
  for (const e of index.ofKind("storage_controller")) b.add(e.id, POOL, "storage_controller");
}

/** Which way a link is drawn: the one it points (`from` to `to`), or reversed, or not at all. */
function direction(index: BlueprintIndex, l: Link): "down" | "up" | undefined {
  // The switch carries the traffic of what is cabled to it, and the server carries the VM that runs on it.
  // A cluster is drawn after its servers (they are its members), though the link says the server depends on it.
  if (l.kind === "network" || l.kind === "runs_on") return "up";
  if (l.kind === "member_of") {
    // a workload leans on the cluster it runs on, as a server does on its cluster (REQ-096)
    const [from, to] = [index.find(l.from)?.kind, index.find(l.to)?.kind];
    return to === "cluster" || from === "k8s_workload" ? "down" : "up";
  }
  // The top of the layer: a service leans on the VMs and servers it runs on. The database and storage layers (REQ-095):
  // a service leans on a cluster or a pool, an instance runs on a VM or server and keeps its data in a pool, a pool is
  // storage nodes. The container layer (REQ-096): a workload leans on its cluster, a node on its server or VM. The overlay (REQ-097): a service leans on its segment, a segment on the VTEPs, a VTEP on its switch,
  // the controller manages the switches; a policy guards a service (so it is drawn the other way).
  if (DRAWN_DOWN.has(l.kind)) return "down";
  return l.kind === "applies_to" ? "up" : undefined;
}

const DRAWN_DOWN: ReadonlySet<Link["kind"]> = new Set([
  "service_on",
  "depends_on",
  "hosted_on",
  "stored_on",
  "backed_by",
  "controls",
  "calls",
]);

export function networkShape(index: BlueprintIndex): LayerShape {
  const b = new ShapeBuilder(NETWORK_STAGES);
  addEquipment(index, b);
  // a breaker watches one call: the caller leans on it
  for (const br of index.ofKind("circuit_breaker")) {
    const ends = breakerEnds(index, br);
    if (ends) b.link(ends.from, br.id);
  }
  for (const l of index.allLinks()) {
    const way = direction(index, l);
    if (way === "up") b.link(l.to, l.from);
    else if (way === "down") b.link(l.from, l.to);
  }
  return b.build();
}
