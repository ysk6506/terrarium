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
export { blueprintDigest } from "./digest";
export {
  FAULT_SPECS,
  type Fault,
  type FaultParamSpec,
  type FaultSpec,
  type FaultType,
  faultSpec,
  isFaultType,
} from "./faults";
export {
  absolutePosition,
  DEFAULT_FLOOR_HEIGHT_M,
  footprint,
  heightU,
  type Position3,
} from "./geometry";
export { BlueprintIndex } from "./graph";
export { KIND_LABELS, kindList, LINK_LABELS } from "./labels";
export { reportedInletC } from "./sensors";
export {
  type Alarm,
  AMBIENT_C,
  type CoolingState,
  type EntityState,
  type Health,
  initialState,
  type PanelState,
  type PduState,
  type RackState,
  type RoomState,
  type ServerState,
  type StateOf,
  type StorageState,
  type SwitchState,
  type UpsState,
  type VmState,
  type WorldState,
} from "./state";
export { hasErrors, type Issue, validateBlueprint } from "./validate";
export {
  ReadOnlyWorldPort,
  World,
  type WorldCommand,
  type WorldEvent,
  type WorldPort,
  type WorldReader,
  type WorldSnapshot,
} from "./world";
