/** core.physics: thermal, power and cooling dynamics, protections and alarms (REQ-005). */
export {
  desiredAlarms,
  INLET_WARNING_C,
  RACK_CRITICAL_C,
  ROOM_CRITICAL_C,
  ROOM_WARNING_C,
} from "./alarms";
export { baselineLag, CLUSTER_CAUSE, updateDb } from "./db";
export { DEFAULT_PHYSICS, Physics, type PhysicsOptions } from "./engine";
export { updateHostOs } from "./os-physics";
export { ambientDerate } from "./plant";
export {
  aggregateLoads,
  capacityW,
  drawW,
  effectiveUtil,
  effectiveUtilAt,
  type Pass,
  POWER_FACTOR,
  passOf,
  SupplyResolver,
  updateBatteries,
  updateDevices,
} from "./power";
export { faultParam } from "./power-supply";
export { updateServices } from "./services";
export { roomHeatW, updateThermal } from "./thermal";
