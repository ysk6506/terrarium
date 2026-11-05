/**
 * The power layer: transformers and generators → UPS → panels → PDUs → racks → servers. Everything above the UPS
 * (transfer switches, transformers, generators) is one column, because that is where the grid and the diesel meet.
 * A server leans on the PDU of its rack, so the rack is drawn between the two: a rack leans on the PDUs mounted in
 * it, and on a panel directly when it is a light rack that has no PDU of its own.
 */
import type { BlueprintIndex } from "@terrarium/core/world";
import { type LayerShape, ShapeBuilder } from "./shape";

const STAGES = [
  { id: "feed", label: "변압기·발전기" },
  { id: "ups", label: "UPS" },
  { id: "panel", label: "분전반" },
  { id: "pdu", label: "PDU" },
  { id: "rack", label: "랙" },
  { id: "server", label: "서버" },
] as const;

const FEED = 0;
const UPS = 1;
const PANEL = 2;
const PDU = 3;
const RACK = 4;
const SERVER = 5;

/** Everything a UPS leans on, and every panel that has a generator behind it: the grid side of the building. */
function gridSide(index: BlueprintIndex): Set<string> {
  const side = new Set<string>();
  const stack: string[] = [];
  const visit = (id: string) => {
    if (side.has(id)) return;
    side.add(id);
    stack.push(id);
  };
  for (const ups of index.ofKind("ups"))
    for (const l of index.outgoing(ups.id, "power")) visit(l.to);
  for (const panel of index.ofKind("power_panel"))
    if (index.outgoing(panel.id, "power").some((l) => index.find(l.to)?.kind === "generator"))
      visit(panel.id);
  while (stack.length > 0)
    for (const l of index.outgoing(stack.pop() as string, "power")) visit(l.to);
  return side;
}

function addEquipment(index: BlueprintIndex, b: ShapeBuilder): void {
  const grid = gridSide(index);
  for (const e of index.ofKind("generator")) b.add(e.id, FEED, "generator");
  for (const e of index.ofKind("power_panel"))
    if (grid.has(e.id)) b.add(e.id, FEED, "feed");
    else b.add(e.id, PANEL, "panel");
  for (const e of index.ofKind("ups")) b.add(e.id, UPS, "ups");
  for (const e of index.ofKind("pdu")) b.add(e.id, PDU, "pdu");
  for (const e of index.ofKind("rack")) b.add(e.id, RACK, "rack");
  for (const e of index.ofKind("server")) b.add(e.id, SERVER, "server");
  for (const e of index.ofKind("storage")) b.add(e.id, SERVER, "storage");
}

export function powerShape(index: BlueprintIndex): LayerShape {
  const b = new ShapeBuilder(STAGES);
  addEquipment(index, b);
  for (const l of index.allLinks()) {
    if (l.kind !== "power") continue;
    const from = index.find(l.from)?.kind;
    if (from === "pdu" || from === "power_panel" || from === "ups" || from === "rack")
      b.link(l.to, l.from);
  }
  // A PDU stands in a rack and feeds it: the rack comes after it, and its servers after the rack.
  for (const pdu of index.ofKind("pdu")) if (pdu.parentId) b.link(pdu.id, pdu.parentId);
  for (const e of [...index.ofKind("server"), ...index.ofKind("storage")])
    if (e.parentId) b.link(e.parentId, e.id);
  return b.build();
}
