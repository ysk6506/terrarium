/**
 * The default models (v1) of the physics slots that have a table to swap in (REQ-113, ADR-0137): each is the formula the
 * engine always had, with the profile's table in front of it. While no table is given the formula runs and the numbers are the
 * same bits as before slots existed (`tests/spec/physics-golden.test.ts`). Pure functions: no clock, no randomness.
 */
import type { ServerModel, UpsModel } from "@terrarium/core/catalog";
import { interpolate, type SlotValues } from "@terrarium/core/physics/slots";
import type { World } from "@terrarium/core/world";

/** Efficiency of a UPS carrying `loadW`: its model's number, or the profile's table over the load ratio. */
export function upsEfficiencyAt(world: World, model: UpsModel, loadW: number): number {
  const curve = world.physics.curve("power.conversion.upsEfficiencyCurve");
  return curve ? interpolate(curve, loadW / (model.capacityKw * 1000)) : model.efficiency;
}

/** What a server draws at a utilisation: idle plus the dynamic range times the utilisation, or the profile's table in its place. */
export function serverDrawW(world: World, model: ServerModel, util: number): number {
  const curve = world.physics.curve("power.device.utilCurve");
  const share = curve ? interpolate(curve, util) : util;
  return model.idlePowerW + (model.maxPowerW - model.idlePowerW) * share;
}

/** Throughput left when `kept` of the dynamic power is allowed: `kept ** exponent` (floored), or the profile's table. */
export function capPerf(world: World, P: SlotValues["power.device"], kept: number): number {
  const curve = world.physics.curve("power.device.capPerfCurve");
  return curve
    ? interpolate(curve, Math.min(1, kept))
    : Math.max(P.capPerfFloor, kept) ** P.capPerfExponent;
}

/** The compressor's coefficient of performance at the outdoor air of the moment. */
export function copAt(world: World, P: SlotValues["cooling.unit"]): number {
  const curve = world.physics.curve("cooling.unit.copCurve");
  return curve ? interpolate(curve, world.outdoorC()) : P.cop;
}

/** Seconds a breaker can carry `ratio` times its capacity, from the profile's table; undefined while the breaker trips by its factor. */
export function tripSeconds(world: World, ratio: number): number | undefined {
  const curve = world.physics.curve("power.protection.tripTimeCurve");
  return curve ? interpolate(curve, ratio) : undefined;
}

/**
 * One step of a breaker's trip curve (inverse-time): heat adds up at `dt / seconds-to-trip` while the load is past the
 * rating and drains over `coolS` below it. Returns the new heat and whether the breaker trips (heat reaches 1, or the
 * table says 0 seconds).
 */
export function breakerStep(
  heat: number,
  input: { ratio: number; dt: number; seconds: number; coolS: number },
): { heat: number; trips: boolean } {
  const { ratio, dt, seconds, coolS } = input;
  if (!(ratio > 1)) return { heat: Math.max(0, heat - dt / coolS), trips: false };
  if (seconds <= 0) return { heat: 1, trips: true };
  const next = heat + dt / seconds;
  return { heat: next, trips: next >= 1 };
}
