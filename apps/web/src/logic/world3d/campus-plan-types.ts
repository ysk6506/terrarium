/** The shapes of the campus layout plan (REQ-105, ADR-0128): what `campusPlan` hands to the view. */
import type { Bounds, Pt } from "./plan";
import type { RoadPlan } from "./roads";

/** What the plan is given about the land: the outline, the gate and the ground that is already spoken for. */
export interface PlanSite {
  readonly outline: readonly Pt[];
  readonly gate: Pt;
  /** Plant yards and unbuilt places: roads, lots and trees all keep off them. */
  readonly obstacles: readonly Bounds[];
  /** Land for sale: lots and trees keep off it, a road may cross it. */
  readonly avoid: readonly Bounds[];
  /** Plant yards that want a road to their edge. */
  readonly yards: ReadonlyArray<{ readonly id: string; readonly area: Bounds }>;
}

export interface PlanBuilding {
  readonly id: string;
  readonly bounds: Bounds;
  readonly servers: number;
}

export interface RoadSeg {
  readonly kind: "road" | "driveway";
  readonly area: Bounds;
}

/** Where a building's door is, and the path from it to the road. */
export interface Entrance {
  readonly id: string;
  readonly face: "n" | "s" | "e" | "w";
  readonly door: Pt;
  /** The end of its path on the road side; the lot is placed near it. */
  readonly front: Pt;
  /** The paved strips from the door to the road; empty when the road did not reach. */
  readonly path: readonly Bounds[];
}

export interface Bay {
  readonly x: number;
  readonly z: number;
  readonly w: number;
  readonly d: number;
}

export interface Parking {
  readonly id: string;
  readonly forId: string;
  readonly area: Bounds;
  /** The way the rows run. */
  readonly along: "x" | "z";
  /** Bays the servers asked for, before the land said how many fit. */
  readonly wanted: number;
  readonly bays: readonly Bay[];
  /** The driving lane between the two rows of bays. */
  readonly aisle: Bounds;
}

export interface ParkedCar {
  readonly x: number;
  readonly z: number;
  readonly rot: number;
  readonly paint: number;
  readonly parking: string;
  readonly bay: number;
}

export interface PlanTree {
  readonly x: number;
  readonly z: number;
  readonly scale: number;
  readonly tint: number;
  readonly row: "fence" | "road" | "grove";
}

export type ZoneKind = "footprint" | "apron" | "entrance" | "yard";

/** Ground that must stay clear of trees, cars and visitors (the entrance path is the one way through an apron). */
export interface ClearZone {
  readonly kind: ZoneKind;
  readonly of: string;
  readonly area: Bounds;
}

export interface Ground {
  readonly roads: readonly RoadSeg[];
  readonly roadPlan: RoadPlan;
  readonly entrances: readonly Entrance[];
  readonly parking: readonly Parking[];
  readonly cars: readonly ParkedCar[];
  readonly clearZones: readonly ClearZone[];
}

export interface CampusPlan extends Ground {
  readonly trees: readonly PlanTree[];
}
