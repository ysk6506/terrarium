/** The entities of one room (ADR-0008): the room itself, its containments, racks, devices and equipment. */
import type { Catalog } from "@terrarium/core/catalog";
import { RACK_DEPTH_M, RACK_WIDTH_M } from "@terrarium/core/kernel";
import { bounds, type Rect, type RoomLayout, rotated } from "@terrarium/core/spatial";
import type { Entity } from "@terrarium/core/world";
import type { Props, RoomSpec } from "./assembly-types";

export interface PendingRoom {
  readonly spec: RoomSpec;
  readonly floorId: string;
  readonly layout: RoomLayout;
}

/** Space round a pod's racks that the containment encloses, metres. */
const POD_PADDING_M = 0.1;

export function roomEntities(
  catalog: Catalog,
  room: PendingRoom,
  at: { x: number; y: number },
): Entity[] {
  const { spec, layout } = room;
  const out: Entity[] = [
    {
      id: spec.id,
      kind: "room",
      name: spec.name,
      parentId: room.floorId,
      placement: { type: "area", x: at.x, y: at.y, w: layout.size.w, d: layout.size.d },
      props: { ...(spec.props ?? {}), ...(spec.purpose ? { purpose: spec.purpose } : {}) },
    },
  ];
  const containerOf = spec.pods ? podEntities(catalog, room, out) : containments(room, out);
  out.push(...rackEntities(room, containerOf), ...deviceEntities(room), ...equipmentEntities(room));
  return out;
}

const inferred = (yes: boolean): Props => (yes ? { positionInferred: true } : {});

function rackRect(
  catalog: Catalog,
  room: PendingRoom,
  modelId: string | undefined,
  id: string,
): Rect | undefined {
  const p = room.layout.racks.get(id);
  if (!p) return undefined;
  let size = { w: RACK_WIDTH_M, d: RACK_DEPTH_M };
  if (modelId && catalog.has(modelId)) {
    const model = catalog.get(modelId);
    if ("footprint" in model) size = model.footprint;
  }
  const r = rotated(size.w, size.d, p.rotation);
  return { x: p.x, y: p.y, w: r.w, d: r.d };
}

/** Containments from explicit pods: each encloses the bounding box of its racks. Returns rack id → pod id. */
function podEntities(catalog: Catalog, room: PendingRoom, out: Entity[]): Map<string, string> {
  const owner = new Map<string, string>();
  const modelOf = new Map(room.spec.racks.map((r) => [r.id, r.modelId]));
  for (const pod of room.spec.pods ?? []) {
    const rects = pod.racks.flatMap((id) => rackRect(catalog, room, modelOf.get(id), id) ?? []);
    const box = bounds(rects);
    if (!box) continue;
    out.push({
      id: pod.id,
      kind: "containment",
      name: pod.name,
      parentId: room.spec.id,
      placement: {
        type: "area",
        x: box.x - POD_PADDING_M,
        y: box.y - POD_PADDING_M,
        w: box.w + 2 * POD_PADDING_M,
        d: box.d + 2 * POD_PADDING_M,
      },
      props: { aisle: pod.aisle },
    });
    for (const id of pod.racks) owner.set(id, pod.id);
  }
  return owner;
}

/**
 * Containments enclose pairs of rack rows: rows 1+2, 3+4 ... face each other across a cold aisle;
 * rows 2+3, 4+5 ... stand back to back across a hot aisle. Returns rack id → containment id.
 */
function containments(room: PendingRoom, out: Entity[]): Map<string, string> {
  const mode = room.spec.containment ?? "none";
  const owner = new Map<string, string>();
  if (mode === "none") return owner;
  const rows = [...new Set([...room.layout.racks.values()].map((p) => p.row))].sort(
    (a, b) => a - b,
  );
  const first = mode === "cold" ? 0 : 1;
  for (let i = first; i + 1 < rows.length; i += 2) {
    const pair = new Set([rows[i], rows[i + 1]]);
    const racks = [...room.layout.racks].filter(([, p]) => pair.has(p.row));
    const xs = racks.map(([, p]) => p.x);
    const ys = racks.map(([, p]) => p.y);
    const n = Math.floor(i / 2) + 1;
    const id = `${room.spec.id}-${mode === "cold" ? "ca" : "ha"}${n}`;
    out.push({
      id,
      kind: "containment",
      name: `${room.spec.name} ${mode === "cold" ? "냉복도" : "열복도"} ${n}`,
      parentId: room.spec.id,
      placement: {
        type: "area",
        x: Math.min(...xs) - 0.1,
        y: Math.min(...ys) - 0.1,
        w: Math.max(...xs) - Math.min(...xs) + 0.8,
        d: Math.max(...ys) - Math.min(...ys) + 1.4,
      },
      props: { aisle: mode },
    });
    for (const [rackId] of racks) owner.set(rackId, id);
  }
  return owner;
}

function rackEntities(room: PendingRoom, containerOf: ReadonlyMap<string, string>): Entity[] {
  return room.spec.racks.flatMap((rack) => {
    const p = room.layout.racks.get(rack.id);
    if (!p) return [];
    return [
      {
        id: rack.id,
        kind: "rack" as const,
        name: rack.name,
        parentId: containerOf.get(rack.id) ?? room.spec.id,
        ...(rack.modelId ? { modelId: rack.modelId } : {}),
        placement: { type: "spot" as const, x: p.x, y: p.y, rotation: p.rotation },
        props: { ...(rack.props ?? {}), ...inferred(p.inferred) },
      },
    ];
  });
}

function deviceEntities(room: PendingRoom): Entity[] {
  return room.spec.devices.flatMap((device) => {
    const p = room.layout.devices.get(device.id);
    if (!p) return [];
    return [
      {
        id: device.id,
        kind: device.kind,
        name: device.name,
        parentId: p.rackId,
        modelId: device.modelId,
        placement: { type: "unit" as const, u: p.u },
        props: { ...(device.props ?? {}), ...inferred(p.inferred) },
      },
    ];
  });
}

function equipmentEntities(room: PendingRoom): Entity[] {
  return room.spec.equipment.map((eq) => {
    const p = room.layout.equipment.get(eq.id) ?? { x: 1, y: 1 };
    return {
      id: eq.id,
      kind: eq.kind,
      name: eq.name,
      parentId: room.spec.id,
      modelId: eq.modelId,
      placement: { type: "spot" as const, x: p.x, y: p.y, rotation: 0 as const },
      props: eq.props ?? {},
    };
  });
}
