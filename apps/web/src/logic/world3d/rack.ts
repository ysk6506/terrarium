/**
 * A rack close up (REQ-006, REQ-045, REQ-049): the devices in it, unit by unit, each with the look of
 * its maker's model, and the neighbouring racks in the same row so it can be seen in place. A light
 * rack has no server entities; it is drawn with as many machines of its model as it counts.
 */
import { type Catalog, type ModelLook, mountOfModel } from "@terrarium/core/catalog";
import {
  type BlueprintIndex,
  bulkOf,
  bulkSlots,
  type Entity,
  isBulkRack,
} from "@terrarium/core/world";
import { type RackKind, rackKindOf } from "./racks";

export interface Device {
  /** The entity id; a light rack's machines are "<rack id>#<n>" and are not entities. */
  readonly id: string;
  readonly kind: "server" | "switch" | "storage" | "pdu";
  readonly name: string;
  readonly modelId: string;
  readonly modelName: string;
  readonly vendor: string;
  /** Bottom unit (1 is the lowest) and height in units; a vertical PDU has 0 units. */
  readonly u: number;
  readonly units: number;
  readonly look: ModelLook;
  readonly synthetic: boolean;
  /** One line about what it is: "GPU 8장", "48포트 25G", … */
  readonly about: string;
}

export interface RackScene {
  readonly id: string;
  readonly name: string;
  readonly kind: RackKind;
  readonly bulk: boolean;
  readonly devices: readonly Device[];
  /** Units taken. */
  readonly used: number;
}

const FALLBACK: ModelLook = { body: "#2b3036", accent: "#4aa3ff", finish: "metal", front: "mesh" };

function aboutModel(catalog: Catalog, modelId: string): string {
  const m = catalog.get(modelId);
  if (m.kind === "server") {
    const unit = mountOfModel(m) === "orv3" ? "OU" : "U";
    return m.gpus > 0
      ? `GPU ${m.gpus}장 · ${m.uHeight}${unit}`
      : `CPU ${m.cpuSockets}소켓 · ${m.uHeight}${unit}`;
  }
  if (m.kind === "switch") return `${m.ports}포트 ${m.portSpeedGbps}G`;
  if (m.kind === "storage") return `${m.capacityTiB} TiB · ${m.disks}디스크`;
  if (m.kind === "pdu" && m.shelf) return `48V 버스바 · ${Math.round(m.capacityW / 1000)}kW`;
  if (m.kind === "pdu") return `${m.outlets}구 · ${Math.round(m.capacityW / 1000)}kW`;
  return m.name;
}

function deviceOf(catalog: Catalog, e: Entity): Device | undefined {
  if (e.kind !== "server" && e.kind !== "switch" && e.kind !== "storage" && e.kind !== "pdu")
    return undefined;
  const placed = e.placement?.type === "unit" ? e.placement.u : undefined;
  if (placed === undefined || !e.modelId || !catalog.has(e.modelId)) return undefined;
  const m = catalog.get(e.modelId);
  return {
    id: e.id,
    kind: e.kind,
    name: e.name,
    modelId: m.id,
    modelName: m.name,
    vendor: m.vendor,
    u: placed,
    units: "uHeight" in m ? m.uHeight : 0,
    look: m.look ?? FALLBACK,
    synthetic: false,
    about: aboutModel(catalog, m.id),
  };
}

function lightDevices(catalog: Catalog, rack: Entity): Device[] {
  const load = bulkOf(rack);
  if (!load || !catalog.has(load.modelId)) return [];
  const m = catalog.get(load.modelId);
  if (m.kind !== "server") return [];
  return bulkSlots(load, m).map((u, n) => ({
    id: `${rack.id}#${n + 1}`,
    kind: "server",
    name: `${rack.name} 서버 ${n + 1}`,
    modelId: m.id,
    modelName: m.name,
    vendor: m.vendor,
    u,
    units: m.uHeight,
    look: m.look,
    synthetic: true,
    about: aboutModel(catalog, m.id),
  }));
}

export function rackScene(
  index: BlueprintIndex,
  catalog: Catalog,
  rackId: string,
): RackScene | undefined {
  const rack = index.find(rackId);
  if (!rack || rack.kind !== "rack") return undefined;
  const kind = rackKindOf(catalog, rack);
  const devices = (
    isBulkRack(rack)
      ? lightDevices(catalog, rack)
      : index.childrenOf(rack.id).flatMap((e) => deviceOf(catalog, e) ?? [])
  ).sort((a, b) => a.u - b.u);
  return {
    id: rack.id,
    name: rack.name,
    kind,
    bulk: isBulkRack(rack),
    devices,
    used: devices.reduce((n, d) => n + d.units, 0),
  };
}

/** The racks standing in a line with this one (same row, nearest first by position), this one included. */
export function rowOf(index: BlueprintIndex, rackId: string, reach = 2): string[] {
  const rack = index.find(rackId);
  if (!rack || rack.placement?.type !== "spot") return [rackId];
  const here = rack.placement;
  const siblings = index
    .childrenOf(rack.parentId ?? "", "rack")
    .filter((r) => r.placement?.type === "spot" && Math.abs(r.placement.y - here.y) < 0.3)
    .sort((a, b) => (a.placement as typeof here).x - (b.placement as typeof here).x);
  const at = siblings.findIndex((r) => r.id === rackId);
  if (at < 0) return [rackId];
  return siblings.slice(Math.max(0, at - reach), at + reach + 1).map((r) => r.id);
}
