/** core.physics: thermal, power and cooling dynamics, protections and alarms (REQ-005). */
export {
  desiredAlarms,
  INLET_WARNING_C,
  RACK_CRITICAL_C,
  ROOM_CRITICAL_C,
  ROOM_WARNING_C,
} from "./alarms";
export { updateApp } from "./app";
export { baselineLag, CLUSTER_CAUSE, updateDb } from "./db";
export { updateDbx } from "./dbx";
export { updateDrs } from "./drs";
export { DEFAULT_PHYSICS, Physics, type PhysicsOptions } from "./engine";
export { updateK8s } from "./k8s";
export {
  KNOWN_V1_EXCEPTIONS,
  type KnownException,
  type LawId,
  LawMonitor,
  type LawReport,
  type Violation,
} from "./laws";
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
export {
  type CapMode,
  type CapPlan,
  type CapServer,
  distributeCap,
  perfUnderCap,
} from "./power-cap";
export { faultParam } from "./power-supply";
export { updateSdn } from "./sdn";
export { updateServices } from "./services";
export { updateSite } from "./site";
export { roomHeatW, updateThermal } from "./thermal";
