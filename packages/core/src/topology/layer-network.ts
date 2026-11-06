/**
 * The network and virtualisation layer: core and spine switches → switches on top of racks (ToR) → servers and
 * storage → virtual machines and clusters. A switch is a ToR when servers or storage are cabled to it; the
 * switches above are told apart by how many steps they are from a ToR. A world with no virtual machines ends at
 * the servers, because a stage with nothing in it is not drawn.
 */
import type { BlueprintIndex } from "@terrarium/core/world";
import { type LayerShape, ShapeBuilder } from "./shape";

const STAGES = [
  { id: "service", label: "서비스" },
  { id: "core", label: "코어 스위치" },
  { id: "spine", label: "스파인 스위치" },
  { id: "tor", label: "ToR 스위치" },
  { id: "host", label: "서버·스토리지" },
  { id: "virtual", label: "VM·클러스터" },
] as const;

const SERVICE = 0;
const CORE = 1;
const SPINE = 2;
const TOR = 3;
const HOST = 4;
const VIRTUAL = 5;

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
}

export function networkShape(index: BlueprintIndex): LayerShape {
  const b = new ShapeBuilder(STAGES);
  addEquipment(index, b);
  for (const l of index.allLinks()) {
    // The switch carries the traffic of what is cabled to it, and the server carries the VM that runs on it.
    // A cluster is drawn after its servers (they are its members), though the link says the server depends on it.
    if (l.kind === "network" || l.kind === "runs_on") b.link(l.to, l.from);
    else if (l.kind === "member_of") b.link(l.from, l.to);
    // The top of the layer: a service leans on the VMs and servers it runs on.
    else if (l.kind === "service_on") b.link(l.from, l.to);
  }
  return b.build();
}
