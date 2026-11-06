/**
 * The network and virtualisation layer: core and spine switches → switches on top of racks (ToR) → servers and
 * storage → virtual machines and clusters. A switch is a ToR when servers or storage are cabled to it; the
 * switches above are told apart by how many steps they are from a ToR. A world with no virtual machines ends at
 * the servers, because a stage with nothing in it is not drawn.
 */
import type { BlueprintIndex, Link } from "@terrarium/core/world";
import { type LayerShape, ShapeBuilder } from "./shape";

const STAGES = [
  { id: "service", label: "서비스" },
  { id: "workload", label: "워크로드·파드" },
  { id: "cluster", label: "쿠버네티스 클러스터" },
  { id: "knode", label: "쿠버네티스 노드" },
  { id: "database", label: "데이터베이스" },
  { id: "instance", label: "DB 인스턴스" },
  { id: "pool", label: "스토리지 풀·컨트롤러" },
  { id: "core", label: "코어 스위치" },
  { id: "spine", label: "스파인 스위치" },
  { id: "tor", label: "ToR 스위치" },
  { id: "host", label: "서버·스토리지" },
  { id: "virtual", label: "VM·클러스터" },
] as const;

const SERVICE = 0;
const WORKLOAD = 1;
const CLUSTER = 2;
const KNODE = 3;
const DATABASE = 4;
const INSTANCE = 5;
const POOL = 6;
const CORE = 7;
const SPINE = 8;
const TOR = 9;
const HOST = 10;
const VIRTUAL = 11;

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
  for (const e of index.ofKind("service")) b.add(e.id, SERVICE, "service");
  addDatabase(index, b);
  addContainers(index, b);
}

/** The container stages next to the services (REQ-096): workloads with their pods, the clusters, their nodes. */
function addContainers(index: BlueprintIndex, b: ShapeBuilder): void {
  for (const e of index.ofKind("k8s_workload")) b.add(e.id, WORKLOAD, "k8s_workload");
  for (const e of index.ofKind("k8s_cluster")) b.add(e.id, CLUSTER, "k8s_cluster");
  for (const e of index.ofKind("k8s_node")) b.add(e.id, KNODE, "k8s_node");
}

/** The database and storage-HA stages next to the services (REQ-095). */
function addDatabase(index: BlueprintIndex, b: ShapeBuilder): void {
  for (const e of index.ofKind("db_cluster")) b.add(e.id, DATABASE, "db_cluster");
  for (const e of index.ofKind("db_instance")) b.add(e.id, INSTANCE, "db_instance");
  for (const e of index.ofKind("storage_pool")) b.add(e.id, POOL, "storage_pool");
  for (const e of index.ofKind("storage_controller")) b.add(e.id, POOL, "storage_controller");
}

/** Which way a link is drawn: `[from, to]` of the shape, or undefined when it is not drawn. */
function drawn(index: BlueprintIndex, l: Link): [string, string] | undefined {
  const [from, to] = [index.find(l.from)?.kind, index.find(l.to)?.kind];
  switch (l.kind) {
    // The switch carries the traffic of what is cabled to it, and the server carries the VM that runs on it.
    case "network":
    case "runs_on":
      return [l.to, l.from];
    // A cluster is drawn after its servers (they are its members), though the link says the server depends on it.
    case "member_of":
      if (to === "cluster" || from === "k8s_workload") return [l.from, l.to];
      return [l.to, l.from];
    // The top of the layer: a service leans on the VMs and servers it runs on, and (REQ-095, REQ-096) on the
    // clusters, pools and workloads it needs; an instance or node runs on a VM or server, a pool is storage nodes.
    case "service_on":
    case "depends_on":
    case "hosted_on":
    case "stored_on":
    case "backed_by":
      return [l.from, l.to];
    default:
      return undefined;
  }
}

export function networkShape(index: BlueprintIndex): LayerShape {
  const b = new ShapeBuilder(STAGES);
  addEquipment(index, b);
  for (const l of index.allLinks()) {
    const ends = drawn(index, l);
    if (ends) b.link(ends[0], ends[1]);
  }
  return b.build();
}
