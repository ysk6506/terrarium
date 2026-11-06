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
const DATABASE = 1;
const INSTANCE = 2;
const POOL = 3;
const DOOR = 4;
const SEGMENT = 5;
const CONTROLLER = 6;
const VTEP = 7;
const CORE = 8;
const SPINE = 9;
const TOR = 10;
const HOST = 11;
const VIRTUAL = 12;

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
  addOverlay(index, b);
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
  if (l.kind === "member_of") return index.find(l.to)?.kind === "cluster" ? "down" : "up";
  // The top of the layer: a service leans on the VMs and servers it runs on. The database and storage layers (REQ-095):
  // a service leans on a cluster or a pool, an instance runs on a VM or server and keeps its data in a pool, a pool is
  // storage nodes. The overlay (REQ-097): a service leans on its segment, a segment on the VTEPs, a VTEP on its switch,
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
]);

export function networkShape(index: BlueprintIndex): LayerShape {
  const b = new ShapeBuilder(STAGES);
  addEquipment(index, b);
  for (const l of index.allLinks()) {
    const way = direction(index, l);
    if (way === "up") b.link(l.to, l.from);
    else if (way === "down") b.link(l.from, l.to);
  }
  return b.build();
}
