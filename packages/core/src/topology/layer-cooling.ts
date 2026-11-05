/**
 * The cooling layer: cooling plant → cooling units (and CDUs) → server rooms → racks → servers. Water goes from
 * the plant to the units; a unit blows into the room it stands in, and the room's racks breathe that air. A rack on
 * a CDU (liquid) leans on it directly. The blueprint links a rack to its units; the board turns that into
 * "the units of this room" so the room is the step between them.
 */
import type { BlueprintIndex } from "@terrarium/core/world";
import { type LayerShape, ShapeBuilder } from "./shape";

const STAGES = [
  { id: "plant", label: "냉각 플랜트" },
  { id: "unit", label: "냉방기" },
  { id: "room", label: "서버룸" },
  { id: "rack", label: "랙" },
  { id: "server", label: "서버" },
] as const;

const PLANT = 0;
const UNIT = 1;
const ROOM = 2;
const RACK = 3;
const SERVER = 4;

function addEquipment(index: BlueprintIndex, b: ShapeBuilder): void {
  for (const e of index.ofKind("chiller")) b.add(e.id, PLANT, "chiller");
  for (const e of index.ofKind("cdu")) b.add(e.id, UNIT, "cdu");
  for (const e of index.ofKind("cooling_unit")) b.add(e.id, UNIT, "crah");
  for (const rack of index.ofKind("rack")) {
    b.add(rack.id, RACK, "rack");
    const room = index.enclosing(rack.id, "room");
    if (room) b.add(room.id, ROOM, "room");
  }
  for (const server of index.ofKind("server"))
    if (server.parentId && index.find(server.parentId)?.kind === "rack")
      b.add(server.id, SERVER, "server");
}

/** The blueprint's cooling links, read as plant → unit and unit → room, or CDU → rack. */
function addCoolingLinks(index: BlueprintIndex, b: ShapeBuilder): void {
  for (const l of index.allLinks()) {
    if (l.kind !== "cooling") continue;
    const from = index.find(l.from);
    const to = index.find(l.to);
    if (!from || !to) continue;
    if (from.kind !== "rack") {
      b.link(to.id, from.id);
      continue;
    }
    const room = index.enclosing(from.id, "room");
    if (to.kind === "cdu") b.link(to.id, from.id);
    else if (room) b.link(to.id, room.id);
  }
}

export function coolingShape(index: BlueprintIndex): LayerShape {
  const b = new ShapeBuilder(STAGES);
  addEquipment(index, b);
  addCoolingLinks(index, b);
  for (const unit of index.ofKind("cooling_unit")) {
    const room = index.enclosing(unit.id, "room");
    if (room) b.link(unit.id, room.id);
  }
  for (const rack of index.ofKind("rack")) {
    const room = index.enclosing(rack.id, "room");
    if (room) b.link(room.id, rack.id);
  }
  for (const server of index.ofKind("server"))
    if (server.parentId) b.link(server.parentId, server.id);
  return b.build();
}
