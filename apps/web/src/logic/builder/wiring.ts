/**
 * Cables, the tycoon way: pick a thing and see what it could plug into, nearest first — or let the
 * builder wire a whole rack or room the way a data centre is usually wired:
 *
 *   devices → the rack's PDUs (A and B)        servers, storage → the rack's ToR switch (else the nearest)
 *   rack    → the two nearest cooling units     PDU A / B → two different panels (A/B power)
 *   cooling units → a panel                    panels → the nearest UPS
 */
import type { Catalog } from "@terrarium/core/catalog";
import { distance } from "@terrarium/core/spatial";
import {
  absolutePosition,
  type Blueprint,
  BlueprintIndex,
  type Entity,
  type EntityKind,
  isBulkRack,
  isRackMountedKind,
  LINK_RULES,
  type LinkKind,
} from "@terrarium/core/world";
import { link, linkProblem } from "./change";
import type { Edit } from "./edit";

export interface Candidate {
  readonly entity: Entity;
  /** Straight-line metres in the site frame (cable runs are longer). */
  readonly metres: number;
}

const pos = (index: BlueprintIndex, catalog: Catalog, id: string) =>
  absolutePosition(index, catalog, id) ?? { x: 0, y: 0, z: 0 };

function metres(index: BlueprintIndex, catalog: Catalog, a: string, b: string): number {
  const pa = pos(index, catalog, a);
  const pb = pos(index, catalog, b);
  return distance({ x: pa.x, y: pa.y }, { x: pb.x, y: pb.y }) + Math.abs(pa.z - pb.z);
}

/** What `from` could depend on by a link of `kind`, nearest first, not yet linked. */
export function candidates(
  index: BlueprintIndex,
  catalog: Catalog,
  from: string,
  kind: LinkKind,
): Candidate[] {
  return LINK_RULES[kind].to
    .flatMap((k) => index.ofKind(k))
    .filter((e) => linkProblem(index, kind, from, e.id) === undefined)
    .map((entity) => ({ entity, metres: metres(index, catalog, from, entity.id) }))
    .sort((a, b) => a.metres - b.metres || a.entity.id.localeCompare(b.entity.id));
}

/**
 * The link kinds an entity can start. A rack is fed through its devices' PDUs; only a light rack
 * (which has no devices to carry the cable) takes power itself, so pass the entity to see that.
 */
export const linkKindsFrom = (kind: EntityKind, entity?: Entity): LinkKind[] =>
  (Object.keys(LINK_RULES) as LinkKind[]).filter(
    (k) =>
      LINK_RULES[k].from.includes(kind) &&
      !(kind === "rack" && k === "power" && !(entity && isBulkRack(entity))),
  );

const hasLink = (index: BlueprintIndex, from: string, kind: LinkKind) =>
  index.outgoing(from, kind).length > 0;

interface WiringState {
  bp: Blueprint;
  added: number;
  /** The index of `bp`, kept until a cable is added (most attempts find the cable already there). */
  index?: BlueprintIndex;
}

/** Apply `link` where it is allowed and missing; count what was added. */
function tryLink(state: WiringState, kind: LinkKind, from: string, to: string | undefined): void {
  if (!to) return;
  const index = state.index ?? new BlueprintIndex(state.bp);
  state.index = index;
  if (linkProblem(index, kind, from, to)) return;
  state.bp = link(state.bp, kind, from, to).blueprint;
  state.index = undefined;
  state.added++;
}

function nearest(
  index: BlueprintIndex,
  catalog: Catalog,
  from: string,
  pool: readonly Entity[],
  n = 1,
): Entity[] {
  return [...pool]
    .sort(
      (a, b) =>
        metres(index, catalog, from, a.id) - metres(index, catalog, from, b.id) ||
        a.id.localeCompare(b.id),
    )
    .slice(0, n);
}

function roomOf(index: BlueprintIndex, id: string): Entity | undefined {
  return index.enclosing(id, "room");
}

/** Things of a kind in the same room, else on the same floor. */
function near(index: BlueprintIndex, id: string, kind: EntityKind): Entity[] {
  const room = roomOf(index, id);
  const inRoom = room ? index.descendants(room.id).filter((e) => e.kind === kind) : [];
  if (inRoom.length > 0) return inRoom;
  const floor = index.enclosing(id, "floor");
  return floor
    ? index.descendants(floor.id).filter((e) => e.kind === kind)
    : [...index.ofKind(kind)];
}

function wireRackInto(state: WiringState, catalog: Catalog, rackId: string): void {
  let index = new BlueprintIndex(state.bp);
  const devices = index
    .childrenOf(rackId)
    .filter((d) => isRackMountedKind(d.kind) && d.kind !== "pdu");
  const pdus = index.childrenOf(rackId, "pdu");
  for (const d of devices) for (const p of pdus) tryLink(state, "power", d.id, p.id);
  index = new BlueprintIndex(state.bp);
  const tor =
    index.childrenOf(rackId, "switch").find((s) => {
      const m = s.modelId && catalog.has(s.modelId) ? catalog.get(s.modelId) : undefined;
      return m && "role" in m && m.role === "tor";
    }) ?? nearest(index, catalog, rackId, near(index, rackId, "switch"))[0];
  for (const d of devices.filter((x) => x.kind === "server" || x.kind === "storage"))
    if (!hasLink(index, d.id, "network")) tryLink(state, "network", d.id, tor?.id);
  index = new BlueprintIndex(state.bp);
  if (!hasLink(index, rackId, "cooling"))
    for (const c of nearest(index, catalog, rackId, near(index, rackId, "cooling_unit"), 2))
      tryLink(state, "cooling", rackId, c.id);
}

export interface Wiring extends Edit {
  /** How many cables were added. */
  readonly added: number;
}

/** Wire everything inside one rack, and the rack to its cooling. */
export function autoWireRack(bp: Blueprint, catalog: Catalog, rackId: string): Wiring {
  const state: WiringState = { bp, added: 0 };
  wireRackInto(state, catalog, rackId);
  return { blueprint: state.bp, select: [rackId], added: state.added };
}

/** Wire a whole room: every rack, PDUs to panels (A and B apart), cooling to panels, panels to UPS. */
export function autoWireRoom(bp: Blueprint, catalog: Catalog, roomId: string): Wiring {
  const state: WiringState = { bp, added: 0 };
  let index = new BlueprintIndex(bp);
  const racks = index.descendants(roomId).filter((e) => e.kind === "rack");
  for (const rack of racks) wireRackInto(state, catalog, rack.id);
  index = new BlueprintIndex(state.bp);
  const panels = nearest(index, catalog, roomId, near(index, roomId, "power_panel"), 64);
  const [panelA, panelB] = [panels[0], panels[1] ?? panels[0]];
  for (const rack of racks)
    for (const pdu of index.childrenOf(rack.id, "pdu"))
      if (!hasLink(index, pdu.id, "power"))
        tryLink(state, "power", pdu.id, pdu.props.feed === "B" ? panelB?.id : panelA?.id);
  index = new BlueprintIndex(state.bp);
  for (const unit of near(index, roomId, "cooling_unit"))
    if (!hasLink(index, unit.id, "power"))
      tryLink(state, "power", unit.id, nearest(index, catalog, unit.id, panels)[0]?.id);
  index = new BlueprintIndex(state.bp);
  for (const panel of panels)
    if (!hasLink(index, panel.id, "power"))
      tryLink(
        state,
        "power",
        panel.id,
        nearest(index, catalog, panel.id, near(index, panel.id, "ups"))[0]?.id,
      );
  return { blueprint: state.bp, select: [roomId], added: state.added };
}
