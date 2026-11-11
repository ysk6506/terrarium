/**
 * Plans for the physics-law checks on days with faults (REQ-113, ADR-0142): for each kind of fault in the fault registry that
 * touches physics, which world to put it in, which entity to hit, and which faults must come with it for the consequences to
 * show (a battery that is degraded only matters while the grid is out). `physicsFaultTypes()` derives the list from the
 * registry, so a fault added later has to get a plan (or be named here as not touching physics).
 */
import { type EntityKind, FAULT_SPECS, type FaultType, type World } from "@terrarium/core/world";
import { siteBlueprint } from "../site-support";
import { accelLab, coolingLab, powerLab } from "./ladder-labs";
import { PHYSICS_WORLDS } from "./physics-worlds";

export type LabName =
  | "room"
  | "campus"
  | "power"
  | "power-2n"
  | "liquid"
  | "rdhx"
  | "immersion"
  | "gpu"
  | "site";

export const LABS: Readonly<Record<LabName, () => import("@terrarium/core/world").Blueprint>> = {
  room: () => (PHYSICS_WORLDS[0] as (typeof PHYSICS_WORLDS)[number])[1](),
  campus: () => (PHYSICS_WORLDS[2] as (typeof PHYSICS_WORLDS)[number])[1](),
  power: () => powerLab("pwr-substation"),
  "power-2n": () => powerLab("pwr-2n-gen"),
  liquid: () => coolingLab("cool-liquid"),
  rdhx: () => coolingLab("cool-rdhx"),
  immersion: () => coolingLab("cool-immersion"),
  gpu: () => accelLab("gpu-training-cluster", { network: "net-leaf-spine" }),
  site: () => siteBlueprint("warm"),
};

export interface Hit {
  readonly type: FaultType;
  readonly kind: Parameters<World["stateAs"]>[1] | "dr_site" | "gpu" | "vm";
  readonly params?: Readonly<Record<string, number>>;
  /** Which of the entities of that kind (default the first). */
  readonly nth?: number;
  /** Hit the rack that an entity of this kind (a tank, a door) belongs to, instead of an entity of `kind`. */
  readonly via?: EntityKind;
  /** Hit every entity of that kind (a whole cooling plant, every UPS), not just one. */
  readonly all?: boolean;
}

export interface Plan {
  /** Worlds to try it in: the first is the one the fault is made for; the others are bigger worlds with the same kind of equipment. */
  readonly labs: readonly LabName[];
  /** The fault itself first, then the ones that must come with it. */
  readonly hits: readonly Hit[];
  /** Seconds with the fault, then seconds after it is removed (the consequences: trips, shutdowns, drain, recovery). */
  readonly holdS: number;
  readonly recoverS: number;
}

const HOUR = 3600;
const hold = (
  lab: LabName | readonly LabName[],
  hits: readonly Hit[],
  holdS = 3 * HOUR,
  recoverS = 2 * HOUR,
): Plan => ({
  labs: typeof lab === "string" ? [lab] : lab,
  hits,
  holdS,
  recoverS,
});
const grid = (): Hit => ({ type: "grid_outage", kind: "ups", all: true });
const utility = (): Hit => ({ type: "utility_outage", kind: "power_panel", all: true });

/** One plan per fault kind that touches physics. */
export const PLANS: Readonly<Partial<Record<FaultType, Plan>>> = {
  cooling_unit_failure: hold(
    ["room", "campus"],
    [{ type: "cooling_unit_failure", kind: "cooling_unit", all: true }],
  ),
  cooling_unit_degraded: hold("room", [
    { type: "cooling_unit_degraded", kind: "cooling_unit", all: true },
  ]),
  setpoint_drift: hold("room", [{ type: "setpoint_drift", kind: "cooling_unit" }]),
  breaker_trip: hold(["room", "campus"], [{ type: "breaker_trip", kind: "pdu" }]),
  grid_outage: hold(["room", "campus"], [grid()], 5 * HOUR),
  ups_battery_degraded: hold(
    "room",
    [{ type: "ups_battery_degraded", kind: "ups", all: true }, grid()],
    5 * HOUR,
  ),
  utility_outage: hold(["power-2n", "campus"], [utility()]),
  generator_start_failure: hold("power-2n", [
    { type: "generator_start_failure", kind: "generator" },
    utility(),
  ]),
  ats_stuck: hold("power-2n", [{ type: "ats_stuck", kind: "power_panel" }, utility()]),
  chiller_failure: hold(
    ["immersion", "campus"],
    [{ type: "chiller_failure", kind: "chiller", all: true }],
  ),
  chiller_degraded: hold("immersion", [{ type: "chiller_degraded", kind: "chiller", all: true }]),
  cdu_failure: hold(["liquid", "campus"], [{ type: "cdu_failure", kind: "cdu", all: true }]),
  cdu_pump_failure: hold("liquid", [{ type: "cdu_pump_failure", kind: "cdu" }]),
  coolant_leak: hold("liquid", [{ type: "coolant_leak", kind: "cdu" }]),
  immersion_circulation_failure: hold("immersion", [
    { type: "immersion_circulation_failure", kind: "rack", via: "immersion_tank" },
  ]),
  fluid_level_low: hold("immersion", [{ type: "fluid_level_low", kind: "immersion_tank" }]),
  rdhx_valve_stuck: hold("rdhx", [{ type: "rdhx_valve_stuck", kind: "rdhx" }]),
  bbu_cell_fault: hold("power", [{ type: "bbu_cell_fault", kind: "bbu" }, grid()]),
  dc_bus_sag: hold("power", [{ type: "dc_bus_sag", kind: "dc_bus" }]),
  utility_feed_loss: hold("power", [{ type: "utility_feed_loss", kind: "substation" }]),
  transformer_overtemp: hold("power", [{ type: "transformer_overtemp", kind: "substation" }]),
  ups_module_fail: hold("power", [{ type: "ups_module_fail", kind: "ups" }]),
  site_power_loss: hold("site", [{ type: "site_power_loss", kind: "dr_site" }]),
  fan_failure: hold("room", [{ type: "fan_failure", kind: "server" }]),
  psu_failure: hold("room", [{ type: "psu_failure", kind: "server" }]),
  cpu_runaway: hold("room", [{ type: "cpu_runaway", kind: "server" }]),
  vm_cpu_spike: hold("room", [{ type: "vm_cpu_spike", kind: "vm" }]),
  gpu_thermal_throttle: hold("gpu", [{ type: "gpu_thermal_throttle", kind: "gpu" }]),
};

/**
 * Faults of the registry outside the facility that do not move heat or electricity: they act on software, the network or
 * data. A fault of the registry that is in neither this list nor `PLANS` fails the coverage test.
 */
const NOT_PHYSICS_DOMAINS: ReadonlySet<string> = new Set(["network", "storage", "virtual", "os"]);
const SERVER_NOT_PHYSICS: ReadonlySet<FaultType> = new Set([
  "sensor_drift",
  "bmc_unresponsive",
  "firmware_update_failure",
  "memory_failure", // stops the service on the server, not the server's draw or heat (service-health.ts)
  "gpu_xid_error",
  "nvlink_down",
]);

/** The fault kinds of the registry that touch heat or electricity: the whole facility domain, and the server ones that change load, fans, power or temperature. */
export function physicsFaultTypes(): FaultType[] {
  return FAULT_SPECS.filter(
    (s) =>
      s.status === "supported" &&
      (s.domain === "facility" ||
        (!NOT_PHYSICS_DOMAINS.has(s.domain) && !SERVER_NOT_PHYSICS.has(s.type)) ||
        s.type === "vm_cpu_spike"),
  ).map((s) => s.type);
}
