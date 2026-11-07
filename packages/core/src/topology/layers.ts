/**
 * The layers of the world (REQ-078, ADR-0084): power, cooling and network-with-virtualisation, each cut into stages
 * that read from the source to the servers. This file hands out the shape of a layer (made once per blueprint),
 * says how each piece of equipment is doing, and answers the questions the fold asks about the shape.
 */
import type { BlueprintIndex } from "@terrarium/core/world";
import type { Impact } from "./impact";
import { accelShape } from "./layer-accel";
import { coolingShape } from "./layer-cooling";
import { networkShape } from "./layer-network";
import { powerShape } from "./layer-power";
import { lineOf } from "./lines";
import { type LayerShape, rackServers } from "./shape";
import type { LayerId, TopologySource, TopoNode, TopoState } from "./types";

export type { LayerShape } from "./shape";

const MAKERS: Readonly<Record<LayerId, (index: BlueprintIndex) => LayerShape>> = {
  power: powerShape,
  cooling: coolingShape,
  network: networkShape,
  accel: accelShape,
};

const shapes = new WeakMap<BlueprintIndex, Map<LayerId, LayerShape>>();

/** The shape of a layer of this blueprint. */
export function layerShape(index: BlueprintIndex, layer: LayerId): LayerShape {
  let byLayer = shapes.get(index);
  if (!byLayer) {
    byLayer = new Map();
    shapes.set(index, byLayer);
  }
  let shape = byLayer.get(layer);
  if (!shape) {
    shape = MAKERS[layer](index);
    byLayer.set(layer, shape);
  }
  return shape;
}

const chains = new WeakMap<BlueprintIndex, Map<string, readonly string[]>>();

/**
 * The containers an equipment stands in, from the site down (not including itself): site, building, floor, room,
 * containment, and for a server its rack. A virtual machine stands where its host does.
 */
export function chainOf(index: BlueprintIndex, id: string): readonly string[] {
  let known = chains.get(index);
  if (!known) {
    known = new Map();
    chains.set(index, known);
  }
  const hit = known.get(id);
  if (hit) return hit;
  const kind = index.find(id)?.kind;
  // A VM stands where its host does; a service where the first place it runs does (its host's containers, not the host).
  const host =
    kind === "vm"
      ? index.outgoing(id, "runs_on")[0]?.to
      : kind === "service"
        ? index.outgoing(id, "service_on")[0]?.to
        : undefined;
  const chain = host
    ? [...chainOf(index, host), host]
    : index
        .ancestors(id)
        .map((e) => e.id)
        .reverse();
  known.set(id, chain);
  return chain;
}

/** Whether an equipment is a physical container of others (a place), as opposed to equipment. */
export const isSpace = (index: BlueprintIndex, id: string): boolean => {
  const k = index.find(id)?.kind;
  return k === "site" || k === "building" || k === "floor" || k === "room" || k === "containment";
};

/** How the board colours things, and what the agents are touching. */
export interface Status {
  readonly impact: Impact;
  stateOf(id: string): TopoState;
  touched(id: string): boolean;
  /** What another team is doing to it right now, if anything. */
  partner(id: string): string | undefined;
}

export function statusOf(source: TopologySource, impact: Impact): Status {
  const { faulted, alarmed } = impact.causes;
  const touched = source.touched;
  return {
    impact,
    stateOf: (id) =>
      faulted.has(id)
        ? "fault"
        : alarmed.has(id)
          ? "alarm"
          : impact.affected.has(id)
            ? "impact"
            : "ok",
    touched: (id) => touched?.has(id) ?? false,
    partner: (id) => source.partners?.get(id),
  };
}

/** The servers standing in a rack (a light rack's count), or 1 for a server; the rest of the equipment holds none. */
function serversOn(source: TopologySource, shape: LayerShape, id: string): number {
  const kind = shape.kindOf.get(id);
  if (kind === "server") return 1;
  if (kind === "rack") return rackServers(source.index, source.index.entity(id));
  return 0;
}

/** One piece of equipment, read: name, colour, one line of status. */
export function nodeOf(
  source: TopologySource,
  shape: LayerShape,
  layer: LayerId,
  status: Status,
  id: string,
): TopoNode {
  const e = source.index.entity(id);
  const partner = status.partner(id);
  return {
    id,
    kind: shape.kindOf.get(id) ?? "server",
    name: e.name,
    state: status.stateOf(id),
    touched: status.touched(id),
    ...(partner ? { partner } : {}),
    line: partner ?? lineOf(source.stateOf(id), layer),
    servers: serversReaching(source, shape, [id]),
  };
}

/**
 * How many servers stand on the given equipment or lean on it, each counted once: follow what leans on it down to
 * the racks (a rack counts its servers, light racks too) or to the servers themselves.
 */
export function serversReaching(
  source: TopologySource,
  shape: LayerShape,
  ids: readonly string[],
): number {
  const seen = new Set<string>();
  const stack = [...ids];
  let servers = 0;
  while (stack.length > 0) {
    const id = stack.pop() as string;
    if (seen.has(id)) continue;
    seen.add(id);
    const kind = shape.kindOf.get(id);
    if (kind === "rack") servers += serversOn(source, shape, id);
    else if (kind === "server") servers += 1;
    else for (const next of shape.consumers.get(id) ?? []) stack.push(next);
  }
  return servers;
}
