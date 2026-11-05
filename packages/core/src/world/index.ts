/** core.world: the world blueprint, entities, dynamic state, event log and snapshots (REQ-001, REQ-014). */
export {
  ALLOWED_PARENTS,
  BLUEPRINT_SCHEMA_VERSION,
  type Blueprint,
  ENTITY_KINDS,
  type Entity,
  type EntityKind,
  emptyBlueprint,
  type FloorStandingKind,
  isFloorStandingKind,
  isRackMountedKind,
  isVirtualKind,
  LINK_RULES,
  type Link,
  type LinkKind,
  MODELLED_KINDS,
  PLACEMENT_OF,
  type Placement,
  type PropValue,
  type RackMountedKind,
  type SpaceKind,
  type VirtualKind,
} from "./blueprint";
export {
  BULK_SWITCH_U,
  type BulkLoad,
  bulkOf,
  bulkPowerW,
  bulkProps,
  bulkSlots,
  bulkUnits,
  isBulkRack,
} from "./bulk";
export { OUTDOOR_RANGE_C } from "./command-check";
export {
  BUILD_RATE_M_PER_M2,
  CONTAINMENT_RATE_M_PER_M2,
  FIT_OUT_RATE_M_PER_M2,
  structureCostM,
} from "./construction";
export { blueprintDigest } from "./digest";
export {
  diagnosisLabel,
  FAULT_SPECS,
  type Fault,
  type FaultParamSpec,
  type FaultSpec,
  type FaultType,
  faultSpec,
  isDiagnosisType,
  isFaultType,
  isMistakeType,
  MISTAKE_SPECS,
  type MistakeType,
} from "./faults";
export {
  absolutePosition,
  DEFAULT_FLOOR_HEIGHT_M,
  footprint,
  heightU,
  mountStandardOf,
  type Position3,
  rackStandardOf,
  rackUnits,
  unitHeightM,
} from "./geometry";
export { BlueprintIndex } from "./graph";
export { KIND_LABELS, kindList, LINK_LABELS } from "./labels";
export {
  LAND_MARKETS,
  LAND_PRICE_M_PER_M2,
  type LandMarket,
  landMarket,
  type PriceBasis,
  PYEONG_M2,
  parcelPriceM,
} from "./land";
export {
  type Cidr,
  cidrText,
  inSubnet,
  intToIp,
  ipToInt,
  lenToMask,
  macOf,
  maskToLen,
  networkOf,
  parseCidr,
  parseHostCidr,
} from "./net-addr";
export type { BgpNeighbor, BgpPlan } from "./net-bgp";
export {
  carries,
  type NetChange,
  type NetPatch,
  type PortCfg,
  type RouteCfg,
  routeKey,
  type SviCfg,
  type SwitchCfg,
} from "./net-config";
export { type Iface, type NetModel, netModelOf, type Owner } from "./net-model";
export { type NetPlan, planOf } from "./net-plan";
export { type CutOff, cutOffHosts, hostIsUp, type RailLoss, railLosses } from "./net-reach";
export { type StpPort, type StpRole, type StpView, stpOf } from "./net-stp";
export type { HostPlan } from "./net-topology";
export {
  type Endpoint,
  type Failure,
  type Hop,
  type PingResult,
  ping,
  resolveRoute,
  resolveVia,
  type Trace,
  trace,
} from "./net-trace";
export { outletConsumer, outletCount, outletOff } from "./outlets";
export { type PreparedWorld, prepareWorld } from "./prepared";
export {
  BUILDING_PURPOSE_LABELS,
  BUILDING_PURPOSES,
  type BuildingPurpose,
  buildingPurposeOf,
  ROOM_PURPOSE_LABELS,
  ROOM_PURPOSES,
  type RoomPurpose,
  roomPurposeOf,
} from "./purpose";
export { reportedInletC } from "./sensors";
export {
  type Alarm,
  AMBIENT_C,
  type CoolingState,
  DEFAULT_OUTDOOR_C,
  type EntityState,
  type Health,
  initialState,
  type PanelState,
  type PduState,
  type RackState,
  type RoomState,
  type ServerState,
  type SiteState,
  type StateOf,
  type StorageState,
  type SwitchState,
  type UpsState,
  type VmState,
  type WorldState,
} from "./state";
export { hasErrors, type Issue, validateBlueprint } from "./validate";
export { isOwned, landProblem } from "./validate-campus";
export {
  ReadOnlyWorldPort,
  World,
  type WorldCheckpoint,
  type WorldCommand,
  type WorldEvent,
  type WorldPort,
  type WorldReader,
  type WorldSnapshot,
} from "./world";
