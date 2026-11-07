import type { EntityKind } from "../blueprint";

/** Kinds only a shaped world builds (GPU layer, power and cooling ladders, REQ-107); the campus sample has none. */
export const SHAPED_ONLY_KINDS: ReadonlySet<EntityKind> = new Set<EntityKind>([
  "gpu",
  "nvlink_domain",
  "ib_fabric",
  "ib_link",
  "job_scheduler",
  "training_job",
  "inference_pool",
  "bbu",
  "dc_bus",
  "substation",
  "rdhx",
  "immersion_tank",
]);

/** The faults that act on those kinds, so they have nothing to act on in the campus sample. */
export const SHAPED_ONLY_FAULTS: readonly string[] = [
  "gpu_xid_error",
  "nvlink_down",
  "ib_link_flap",
  "gpu_thermal_throttle",
  "gpu_memory_leak_inference",
  "job_stuck_checkpoint",
  "scheduler_down",
  "mig_misconfig",
  "bbu_cell_fault",
  "dc_bus_sag",
  "utility_feed_loss",
  "transformer_overtemp",
  "rdhx_valve_stuck",
  "fluid_level_low",
];
