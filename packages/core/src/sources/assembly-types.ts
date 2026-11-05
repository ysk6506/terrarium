/** What a world source tells the assembler (ADR-0008): what is where, never the geometry of the site. */
import type { LocationHint, RackSpot } from "@terrarium/core/spatial";
import type {
  Blueprint,
  Issue,
  PropValue,
  RackMountedKind,
  RoomPurpose,
} from "@terrarium/core/world";

export type Props = Readonly<Record<string, PropValue>>;

export interface RackSpec {
  readonly id: string;
  readonly name: string;
  readonly hint: LocationHint;
  readonly props?: Props;
  /** A rack model (wide, liquid-cooled, a tank); the standard 42U rack when omitted. */
  readonly modelId?: string;
  /** Known place in the room. Racks with one skip the hint-derived grid. */
  readonly at?: RackSpot;
}

export interface DeviceSpec {
  readonly id: string;
  readonly kind: RackMountedKind;
  readonly name: string;
  readonly modelId: string;
  readonly hint: LocationHint;
  /** Explicit rack (e.g. from a graph edge); wins over the hint's rack reference. */
  readonly rackId?: string;
  readonly props?: Props;
}

export interface EquipmentSpec {
  readonly id: string;
  readonly kind: "cooling_unit" | "power_panel" | "ups" | "cdu";
  readonly name: string;
  readonly modelId: string;
  readonly props?: Props;
  /** Known place in the room (metres, room frame); lined up along the front when omitted. */
  readonly at?: { readonly x: number; readonly y: number };
}

/** A containment around a group of racks: a cold or hot aisle sealed off from the room. */
export interface PodSpec {
  readonly id: string;
  readonly name: string;
  readonly aisle: "cold" | "hot";
  readonly racks: readonly string[];
}

export interface RoomSpec {
  readonly id: string;
  readonly name: string;
  readonly racks: readonly RackSpec[];
  readonly devices: readonly DeviceSpec[];
  readonly equipment: readonly EquipmentSpec[];
  /** Enclose rack pairs facing a cold aisle (or back to back across a hot aisle). */
  readonly containment?: "cold" | "hot" | "none";
  /** Explicit containments; they replace `containment`. */
  readonly pods?: readonly PodSpec[];
  /** What the room is for; a data hall when omitted. */
  readonly purpose?: RoomPurpose;
  /** At least this big (metres), e.g. a plant room larger than its equipment needs. */
  readonly size?: { readonly w: number; readonly d: number };
  /** Where the room's corner stands on its floor (metres). Given for every room of a floor, they replace the packing. */
  readonly at?: { readonly x: number; readonly y: number };
  readonly props?: Props;
}

/** Equipment that stands on the site grounds rather than in a building (REQ-043). */
export interface YardSpec {
  readonly id: string;
  readonly kind: "chiller" | "generator" | "power_panel";
  readonly name: string;
  readonly modelId: string;
  readonly props?: Props;
}

export interface AssemblyResult {
  readonly blueprint: Blueprint;
  readonly issues: readonly Issue[];
  /** Where geometry or slots had to be guessed, for the import report. */
  readonly notes: readonly string[];
}
