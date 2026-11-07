/**
 * The accelerator layer (REQ-107, ADR-0130): GPU → node → fabric → job or pool. A GPU stands in its server; the server's
 * link joins the scale-out fabric; a training job leans on its nodes (and on the fabric when there is one) and an
 * inference pool on the servers it serves from. The blueprint holds this in props, and the board reads it as stages.
 */
import { Accel, type BlueprintIndex } from "@terrarium/core/world";
import { type LayerShape, ShapeBuilder } from "./shape";

const STAGES = [
  { id: "gpu", label: "GPU" },
  { id: "node", label: "노드" },
  { id: "fabric", label: "패브릭" },
  { id: "work", label: "잡·풀" },
] as const;

const GPU = 0;
const NODE = 1;
const FABRIC = 2;
const WORK = 3;

export function accelShape(index: BlueprintIndex): LayerShape {
  const b = new ShapeBuilder(STAGES);
  const fabric = Accel.fabricOf(index);
  for (const g of index.ofKind("gpu")) b.add(g.id, GPU, "gpu");
  for (const g of index.ofKind("gpu")) b.add(Accel.serverOfAccel(g), NODE, "server");
  if (fabric) b.add(fabric.id, FABRIC, "ib_fabric");
  for (const job of Accel.jobsOf(index)) b.add(job.id, WORK, "job");
  for (const pool of Accel.poolsOf(index)) b.add(pool.id, WORK, "pool");
  for (const g of index.ofKind("gpu")) b.link(g.id, Accel.serverOfAccel(g));
  const through = (server: string, work: string) => {
    if (fabric) {
      b.link(server, fabric.id);
      b.link(fabric.id, work);
    } else b.link(server, work);
  };
  for (const job of Accel.jobsOf(index)) {
    const def = Accel.jobDef(job);
    for (const s of [...def.nodes, ...def.spares]) through(s, job.id);
  }
  for (const pool of Accel.poolsOf(index))
    for (const s of Accel.poolDef(pool).servers) b.link(s, pool.id);
  return b.build();
}
