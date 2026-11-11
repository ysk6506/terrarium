/**
 * The vocabulary of the physics slots (REQ-113, ADR-0137): what a slot, a named parameter, a curve and a contract field
 * are. Plain data, no behaviour: the registry (`registry.ts`) lists the fourteen slots, the profile (`profile.ts`) says
 * which values an experiment changed.
 */

export const SLOT_IDS = [
  "thermal.room",
  "thermal.device",
  "cooling.unit",
  "cooling.liquid",
  "cooling.plant",
  "env.weather",
  "power.device",
  "power.conversion",
  "power.protection",
  "power.storage",
  "reliability.hazard",
  "network.link",
  "perf.service",
] as const;

export type SlotId = (typeof SLOT_IDS)[number];

/** Where an override may apply. `world` is everywhere; the others name one place or one equipment model. */
export const SCOPE_KINDS = ["world", "building", "room", "rack", "model"] as const;
export type ScopeKind = (typeof SCOPE_KINDS)[number];

/** How specific a scope is: a more specific override beats a less specific one. */
export const SCOPE_RANK: Readonly<Record<ScopeKind, number>> = {
  world: 0,
  model: 1,
  building: 2,
  room: 3,
  rack: 4,
};

/** A number a person may change: what it is, its unit, what it is today, what it may be, and one line of why it matters. */
export interface ParamSpec {
  readonly default: number;
  readonly unit: string;
  readonly min: number;
  readonly max: number;
  /** One line in Korean: what the number does. */
  readonly ko: string;
}

/** A table a person may give instead of a formula: y over x, joined by straight lines, held flat past both ends. */
export interface CurveSpec {
  readonly xUnit: string;
  readonly yUnit: string;
  readonly xMin: number;
  readonly xMax: number;
  readonly yMin: number;
  readonly yMax: number;
  readonly ko: string;
  /** What the v1 formula amounts to, as a few points to start from (the engine uses the formula itself while no curve is given). */
  readonly sample: ReadonlyArray<readonly [number, number]>;
}

/** One field of a slot's input or output, with its unit. */
export interface FieldSpec {
  readonly name: string;
  readonly unit: string;
  readonly ko: string;
}

export type ParamTable = Readonly<Record<string, ParamSpec>>;
export type CurveTable = Readonly<Record<string, CurveSpec>>;

export interface SlotSpec {
  readonly id: SlotId;
  readonly ko: string;
  /** Which places an override of this slot's numbers may name. */
  readonly scopes: readonly ScopeKind[];
  readonly input: readonly FieldSpec[];
  readonly output: readonly FieldSpec[];
  /** What the default model (v1) does, in one sentence. */
  readonly v1: string;
  readonly params: ParamTable;
  readonly curves: CurveTable;
}

/** A name a profile may use: `slot.param`, found in the registry. */
export type Point = readonly [number, number];
