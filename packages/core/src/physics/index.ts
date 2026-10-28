/** core.physics: thermal, power and cooling dynamics, protections and alarms (REQ-005). */
export {
  desiredAlarms,
  INLET_WARNING_C,
  RACK_CRITICAL_C,
  ROOM_CRITICAL_C,
  ROOM_WARNING_C,
} from "./alarms";
export { DEFAULT_PHYSICS, Physics, type PhysicsOptions } from "./engine";
export {
  aggregateLoads,
  capacityW,
  drawW,
  effectiveUtil,
  POWER_FACTOR,
  SupplyResolver,
  updateBatteries,
  updateDevices,
} from "./power";
export { OUTDOOR_C, roomHeatW, updateRack, updateRoom } from "./thermal";
