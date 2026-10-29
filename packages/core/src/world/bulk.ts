/**
 * Light racks (REQ-049): a rack that stands for its servers by count instead of holding them one by
 * one. A hall of thousands of racks is mostly the same few things repeated; keeping every server as
 * an entity would make each step of the simulation cost as much as the whole hall has parts. A light
 * rack keeps what the rest of the world can see of it: where it stands, what it draws, the heat it
 * gives off, how it is cooled and fed. What it gives up is per-server detail.
 */
import type { ServerModel } from "@terrarium/core/catalog";
import { clamp } from "@terrarium/core/kernel";
import type { Entity, PropValue } from "./blueprint";

/** What a light rack holds: `servers` machines of one model, at a mean CPU load. */
export interface BulkLoad {
  readonly servers: number;
  readonly modelId: string;
  /** Mean CPU utilisation, 0..1. */
  readonly util: number;
  /** Power of everything else in the rack (top-of-rack switch, PDU losses), W. */
  readonly overheadW: number;
}

/** Rack units taken by the top-of-rack switch of a light rack. */
export const BULK_SWITCH_U = 1;

/** Props that make a rack a light rack. */
export function bulkProps(load: BulkLoad): Record<string, PropValue> {
  return {
    bulk: true,
    bulkServers: load.servers,
    bulkModel: load.modelId,
    bulkUtil: Math.round(load.util * 1000) / 1000,
    bulkOverheadW: Math.round(load.overheadW),
  };
}

const cache = new WeakMap<Entity, BulkLoad | null>();

/** The load a light rack stands for, or undefined for an ordinary rack or props that do not add up. */
export function bulkOf(rack: Entity): BulkLoad | undefined {
  if (rack.kind !== "rack") return undefined;
  const known = cache.get(rack);
  if (known !== undefined) return known ?? undefined;
  const parsed = parseBulk(rack);
  cache.set(rack, parsed ?? null);
  return parsed;
}

function parseBulk(rack: Entity): BulkLoad | undefined {
  const p = rack.props;
  if (p.bulk !== true) return undefined;
  const servers = Number(p.bulkServers);
  const util = Number(p.bulkUtil ?? 0.3);
  const overheadW = Number(p.bulkOverheadW ?? 0);
  if (!Number.isInteger(servers) || servers < 0) return undefined;
  if (typeof p.bulkModel !== "string" || p.bulkModel === "") return undefined;
  if (!Number.isFinite(util) || !Number.isFinite(overheadW) || overheadW < 0) return undefined;
  return { servers, modelId: p.bulkModel, util: clamp(util, 0, 1), overheadW };
}

export const isBulkRack = (rack: Entity): boolean => bulkOf(rack) !== undefined;

/** Electric power a light rack draws while it is fed, W. */
export function bulkPowerW(load: BulkLoad, model: ServerModel, util: number = load.util): number {
  const perServer = model.idlePowerW + (model.maxPowerW - model.idlePowerW) * clamp(util, 0, 1);
  return load.overheadW + load.servers * perServer;
}

/** Rack units the servers of a light rack and its switch take. */
export function bulkUnits(load: BulkLoad, model: ServerModel): number {
  return load.servers * model.uHeight + BULK_SWITCH_U;
}

/** Where the servers of a light rack stand, bottom unit of each, for drawing: from U1 up, switch on top. */
export function bulkSlots(load: BulkLoad, model: ServerModel): number[] {
  return Array.from({ length: load.servers }, (_, i) => 1 + i * model.uHeight);
}
