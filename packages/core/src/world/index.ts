/** core.world: the world blueprint, entities, dynamic state, event log and snapshots (REQ-001, REQ-014). */
export * as Accel from "./accel-api";
export {
  appInstancesOf,
  breakerDef,
  breakerEnds,
  breakerOfLink,
  breakers,
  callDef,
  callsIn,
  hostOfApp,
  instanceOfSidecar,
  LB_FAIL_CHECKS,
  LB_RECOVER_CHECKS,
  lbOf,
  loadBalancerDef,
  MESH_REVISION,
  meshControls,
  REGION_RECOVER_S,
  RELOGIN_S,
  regionOf,
  regionsOf,
  STALE_LAG_S,
  servicesBehind,
  sessionStoreOf,
  sidecarOf,
} from "./app";
export {
  BLUEPRINT_SCHEMA_VERSION,
  type Blueprint,
  ENTITY_KINDS,
  type Entity,
  type EntityKind,
  emptyBlueprint,
  type FloorStandingKind,
  isFloorStandingKind,
  isRackMountedKind,
  LINK_RULES,
  type Link,
  type LinkKind,
  type Placement,
  type PropValue,
  type RackMountedKind,
} from "./blueprint";
export { type BulkLoad, bulkOf, bulkPowerW, bulkProps, bulkSlots, isBulkRack } from "./bulk";

("./command-check");

export { BUILD_RATE_M_PER_M2, FIT_OUT_RATE_M_PER_M2, structureCostM } from "./construction";
export {
  clusterOf,
  controllersOf,
  DB_ROLE_LABELS,
  DB_SHAPE_LABELS,
  type DbStatus,
  dbClusterDef,
  dbClusterProps,
  hostedOn,
  instancesOf,
  MULTIPATH_SWITCH_S,
  nodesOfPool,
  poolDef,
  poolOfInstance,
  poolProps,
  RESTORE_S,
} from "./db";
export { backupAgeS, bestCandidate } from "./db-act";

("./db-health");

export { blueprintDigest } from "./digest";
export {
  DOMAIN_IDS,
  DOMAINS,
  type Domain,
  domainChoices,
  domainInfo,
  faultDomain,
  isDomain,
  parseDomain,
} from "./domains";
export {
  diagnosisLabel,
  FAULT_SPECS,
  type Fault,
  type FaultSpec,
  type FaultType,
  faultSpec,
  isDiagnosisType,
  isFaultType,
  isMistakeType,
  isTaskType,
  MISTAKE_SPECS,
  type MistakeType,
} from "./faults";

export {
  FIRMWARE_LABELS,
  type FirmwareComponent,
  imageName,
  parseImage,
  REBOOT_SECONDS,
  SHIPPED_FIRMWARE,
  STAGE_SECONDS,
  updateSeconds,
  willFail,
} from "./firmware";
export {
  buildingFloorSpaces,
  type FloorSpace,
  floorSpace,
  isSizeLocked,
  RACK_AREA_M2,
  racksThatFit,
  roomiestOtherFloor,
  WHITE_FLOOR_SHARE,
} from "./floor-space";
export {
  absolutePosition,
  DEFAULT_FLOOR_HEIGHT_M,
  footprint,
  heightU,
  rackStandardOf,
  rackUnits,
  unitHeightM,
} from "./geometry";
export { BlueprintIndex } from "./graph";
export { DB_PROCESS, hostOsOf } from "./host-os";
export {
  ALARM_TOOLS,
  type AlarmLife,
  alarmLives,
  GENERATOR_CAUSE,
  type Incident,
  incidents,
} from "./incidents";
export {
  BACKOFF_FIRST_S,
  BACKOFF_MAX_S,
  clusterOfK8s,
  controlPlaneOf,
  DISK_PRESSURE_PCT,
  DRS_GAP,
  DRS_HOT_UTIL,
  DRS_MIGRATE_S,
  EVICTED_KEEP_S,
  k8sClusterDef,
  k8sClusterProps,
  k8sNodeDef,
  k8sNodeProps,
  k8sWorkloadDef,
  k8sWorkloadProps,
  NODE_GRACE_S,
  type NodeRole,
  nodeHost,
  nodesOfCluster,
  POD_START_S,
  podSuffix,
  servicesOfWorkload,
  workersOf,
  workloadsOfCluster,
  workloadsOfService,
} from "./k8s";
export { workloadOfPod } from "./k8s-act";
export { standsOnCluster, workloadVerdict } from "./k8s-health";
export { bindPending, livePods, type NodeRef, newPod, type WorkloadRef } from "./k8s-sched";
export { KIND_LABELS, kindList } from "./labels";
export {
  type AppBuild,
  builtChip,
  CHIP_COUNT,
  type ChipBuild,
  type ChipMech,
  chipById,
  type DatabaseBuild,
  type DbxBuild,
  LADDER,
  LAYER_IDS,
  type LayerId,
  type Layers,
  layersProblem,
  type OverlayBuild,
  type PoolBuild,
  type Problem,
  type SiteBuild,
} from "./ladder";
export { cheapestWay, placeOf, pointlessOf, unmetNeeds, unmetOf, withChoice } from "./ladder-rules";
export { LAND_MARKETS, landMarket, PYEONG_M2, parcelPriceM } from "./land";
export {
  type Clock,
  clockAt,
  DEFAULT_LEAD_SETTINGS,
  describeLeadSettings,
  formatSpan,
  isDefaultLeadSettings,
  LEAD_ROWS,
  type LeadTimeSettings,
  leadRange,
  resolveLeadSettings,
  roundLead,
  SLA_LABELS,
  SPARE_LABELS,
  START_LABELS,
  sampleLead,
  workWindow,
} from "./lead-times";
export {
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
export { carries, type NetChange, type PortCfg, type SviCfg } from "./net-config";
export { type Iface, type NetModel, netModelOf, type Owner } from "./net-model";
export { type NetPlan, planOf } from "./net-plan";
export { type CutOff, cutOffHosts, hostIsUp, railLosses } from "./net-reach";
export { type StpPort, type StpView, stpOf } from "./net-stp";
export type { HostPlan } from "./net-topology";
export {
  type Endpoint,
  type Failure,
  type PingResult,
  ping,
  resolveRoute,
  type Trace,
  trace,
} from "./net-trace";
export {
  AUTH_SKEW_S,
  DISK_FULL_PCT,
  type HostOs,
  line,
  logTo,
  memoryOf,
  OS_FAULT_TYPES,
  type OsProcess,
} from "./os";
export {
  type Cmd as ShellCmd,
  changesWorld,
  type R as ShellCmdResult,
  registerShellCommand,
  runLine,
} from "./os/index";
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
export { ReadOnlyWorldPort } from "./read-only";
export {
  coveredBy,
  insideRoom,
  insideRoomLocal,
  outlineOf,
  roomArea,
  roomBounds,
  roomLocalRects,
  roomOutline,
  roomRects,
  shapeProblem,
  shapesOverlap,
} from "./room-shape";
export type {
  CounterpartEvent,
  HandedFault,
  HumanEvent,
  RecentCall,
  RunEvent,
  TicketEvent,
  TicketSnapshot,
  TicketStatus,
  ToolEvent,
} from "./run-events";
export {
  EVPN_REESTABLISH_S,
  leafOfServer,
  policiesOf,
  SDN_REVISION,
  sdnControllerDef,
  sdnControllers,
  segmentsOfVtep,
  serverUnder,
  servicesLeaningOn,
  switchOfVtep,
  vtepOfSwitch,
  vtepsOfSegment,
} from "./sdn";
export { activeController, vtepFor } from "./sdn-act";

("./sdn-health");

export {
  deadUplinks,
  liveCables,
  reachableFrom,
  type UnderlayPath,
  underlayPath,
} from "./sdn-underlay";
export { reportedInletC } from "./sensors";
export {
  SERVICE_KIND_LABELS,
  SERVICE_KINDS,
  type ServiceDef,
  type ServiceKind,
  type ServiceStatus,
  SLOW_HARM_SHARE,
  serviceDef,
  serviceProps,
} from "./service";

("./service-act");

export { isVirtualKind } from "./blueprint";
export { bulkUnits } from "./bulk";
export { CONTAINMENT_RATE_M_PER_M2 } from "./construction";
export { SILENT_SITE_FAULTS } from "./faults-site";
export { bareRects, CORE_SHARE } from "./floor-space";
export { LINK_LABELS } from "./labels";
export { type CatalogCard, catalogCard, SERVICE_CATALOG } from "./service-catalog";
export {
  harmShare,
  impairedAt,
  peakImpaired,
  type ServiceTimeline,
  serviceTimeline,
  statusBefore,
} from "./service-events";
export { hostOfVm, hostVerdict, serviceHealth, switchAlive } from "./service-health";
export type { SiteCommand } from "./site-act";
export {
  ACTIVE_DRAIN_S,
  AZ_DETECT_S,
  AZ_STALL_S,
  asyncLagS,
  azNames,
  buildingOf,
  COLD_FAILOVER_S,
  COLD_RPO_S,
  type DrPlanDef,
  type DrSiteDef,
  type DrTargets,
  drPlanDef,
  drPlans,
  drSiteDef,
  drSites,
  drTargets,
  ELECTION_S,
  EXTEND_DELAY_S,
  FAILBACK_S,
  FLAP_PERIOD_S,
  HOT_DETECT_S,
  HOT_SWITCH_S,
  linkMsOf,
  MANAGED_KRW_PER_HOUR,
  majority,
  managedOf,
  ownerOf,
  planOfTarget,
  ringOf,
  SITE_MODE_LABELS,
  type SiteMode,
  type StreamDef,
  SYNC_FALLBACK_S,
  SYNC_SLOW_MS,
  serversOfSite,
  siteLinks,
  siteOf,
  spanText,
  streamDef,
  streams,
  streamsOfPlan,
  volumes,
  WARM_FAILOVER_S,
} from "./site-dr";
export { drainedSites, drCovers, type SiteVerdict, siteHealth } from "./site-health";
export {
  drillOf,
  effectiveRtoS,
  linkState,
  protectedServices,
  ringDown,
  volumesOfPlan,
} from "./site-model";
export { designDrawW, type PowerCapacity, powerCapacityOf, siteDrawW } from "./site-power";
export {
  type Alarm,
  type CoolingState,
  DEFAULT_OUTDOOR_C,
  type EntityState,
  type Health,
  initialState,
  type PanelState,
  type PduState,
  type PodState,
  type RackState,
  type ServerState,
  type StateOf,
  type UpsState,
} from "./state";
export type { BreakerState } from "./state-app";
export type {
  DbManagedState,
  DbNodeState,
  DrillResult,
  DrPlanState,
  DrSiteState,
  SiteLinkState,
  StreamState,
  VolumeState,
} from "./state-site";
export { hasErrors, type Issue, validateBlueprint } from "./validate";
export { isOwned, landProblem } from "./validate-campus";
export {
  DAY_PATTERNS,
  DEFAULT_WORKLOAD,
  daytimeShare,
  heaviest,
  RESOURCE_LABELS,
  RESOURCES,
  type Resource,
  WORKLOAD_KINDS,
  type WorkloadKind,
  type WorkloadProfile,
  workloadOf,
  workloadProblem,
  workloadProps,
} from "./workload";
export {
  World,
  type WorldCheckpoint,
  type WorldCommand,
  type WorldEvent,
  type WorldPort,
  type WorldReader,
} from "./world";
