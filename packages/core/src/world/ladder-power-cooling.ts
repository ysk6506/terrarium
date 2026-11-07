/**
 * The choices REQ-107 adds to the power and cooling ladders (ADR-0130). Each keeps what the one before it had and adds what
 * the words say: a spare UPS module, rack batteries with a 48 V DC bus, an own substation; rear doors, immersion.
 */
import type { ChipMech } from "./ladder";
import { c } from "./ladder-kit";

/** N+1 UPS: A+B feeds, one UPS module more than the load needs on each side. */
export const PWR_N1: ChipMech = c("power", "pwr-n1-ups", {
  build: { feeds: 2, power: { upsSpare: true } },
  stops: ["utility_outage"],
  slows: ["breaker_trip", "grid_outage", "ups_battery_degraded", "ups_module_fail", "psu_failure"],
  costM: 90,
});

/** Rack batteries (BBU) and a 48 V DC bus on top of the automatic 2N chain. */
export const PWR_BBU: ChipMech = c("power", "pwr-rack-bbu", {
  build: {
    feeds: 2,
    power: {
      upsSpare: true,
      generator: true,
      fuelHours: 48,
      spareGenerator: true,
      rackBattery: true,
    },
  },
  stops: [],
  slows: [
    "ats_stuck",
    "generator_start_failure",
    "bbu_cell_fault",
    "dc_bus_sag",
    "ups_module_fail",
  ],
  costM: 480,
});

/** An own substation: two transformers on two utility feeds in front of the ATS. */
export const PWR_SUBSTATION: ChipMech = c("power", "pwr-substation", {
  build: {
    feeds: 2,
    power: {
      upsSpare: true,
      generator: true,
      fuelHours: 48,
      spareGenerator: true,
      rackBattery: true,
      substation: true,
    },
  },
  stops: [],
  slows: [
    "utility_feed_loss",
    "transformer_overtemp",
    "ats_stuck",
    "generator_start_failure",
    "bbu_cell_fault",
    "dc_bus_sag",
  ],
  costM: 1400,
});

/** Rear-door heat exchangers on the dense racks, fed by a liquid loop. */
export const COOL_RDHX: ChipMech = c("cooling", "cool-rdhx", {
  build: { cooling: "2N", containment: true, liquid: "rdhx" },
  stops: [],
  slows: [
    "cooling_unit_failure",
    "chiller_failure",
    "chiller_degraded",
    "rdhx_valve_stuck",
    "coolant_leak",
  ],
  costM: 150,
});

/** Immersion tanks: the fluid carries nearly all the heat; any compute fits. */
export const COOL_IMMERSION: ChipMech = c("cooling", "cool-immersion", {
  build: { cooling: "2N", containment: true, liquid: "immersion" },
  stops: [],
  slows: ["immersion_circulation_failure", "fluid_level_low", "cdu_failure", "chiller_degraded"],
  costM: 300,
});
