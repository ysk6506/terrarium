/** core.physics: thermal, power and cooling dynamics, protections and alarms (REQ-005). */
export {
  desiredAlarms,
  INLET_WARNING_C,
  RACK_CRITICAL_C,
  ROOM_CRITICAL_C,
  ROOM_WARNING_C,
} from "./alarms";
export { DEFAULT_PHYSICS, Physics, type PhysicsOptions } from "./engine";
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
export { roomHeatW, updateThermal } from "./thermal";
