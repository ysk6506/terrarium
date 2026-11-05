/** The 3D view's model: what to draw for the site, a building, a room and a rack, as plain data (REQ-006, REQ-036). */
export {
  AIR_NOTE,
  AIR_SCALES,
  AIR_VIEWS,
  AIR_WORDS,
  type Airflow,
  type AirReadings,
  type AirView,
  ARROWS_PER_PATH,
  airColor,
  airflowOf,
  aisleReach,
  CRITICAL_C,
  doorColor,
  type Field,
  type FlowPath,
  fieldAt,
  frameText,
  hottestOf,
  hottestText,
  loadShareOf,
  marginText,
  type PathKind,
  type Point3,
  PUFF_BUDGET,
  type RackAir,
  type RackSpot,
  type UnitAir,
  type UnitSpot,
  WARN_C,
  workBounds,
} from "./airflow";
export {
  type BuildingScene,
  buildingScene,
  type FloorScene,
  type PlacedRoom,
} from "./building";
export {
  type Box3,
  type Crumb,
  crumbsOf,
  DEFAULT_ANGLES,
  EXPLODE_M,
  type Focus,
  fitDistance,
  floorY,
  focusBox,
  focusOf,
  type Lens,
  type Pose,
  poseFor,
  positionOf,
  sameFocus,
} from "./camera";
export {
  type Block,
  type BlockUse,
  type Campus,
  CELL_M,
  type Piece,
  type PieceKind,
  STREET_M,
  type Street,
} from "./campus";
export { GROUNDS } from "./campus-layouts";
export type {
  Crew,
  CrewActivity,
  CrewAlarm,
  CrewOptions,
  CrewPerson,
  CrewPose,
  CrewRole,
  CrewSituation,
  CrewState,
  CrewWorld,
  Desk,
} from "./crew";
export { CREW_LINES, lineFor } from "./crew-lines";
export { type EquipBox, equipOf, styleOf } from "./equip";
export { type BayDecor, bayDecor, type ProcessTool, type Rail } from "./fab";
export { focusOfLevel, type PlanFrame, type PlanPt, planFrame, toPlan, toSite } from "./frame";
export {
  type Agent,
  isVehicle,
  type LifeKind,
  type LifeOptions,
  type LifePose,
  lifeOf,
  MAX_AGENTS,
  poseAt as lifePoseAt,
  VEHICLE_KINDS,
} from "./life";
export { freshness, type Marker, markersOf } from "./markers";
export {
  COOLING_MODES,
  type CoolingMode,
  hallMode,
  MODE_LABELS,
  type RackForm,
  racksIn,
  serversIn,
} from "./modes";
export { LAYERS, type Layer, type Overlay, rackColor, rackColors } from "./overlay";
export {
  HEAT_STOPS,
  heatColor,
  hex,
  MODE_COLORS,
  mix,
  PURPOSE_COLORS,
  type Rgb,
  THEME,
  WORKER_COLORS,
} from "./palette";
export { type Bounds, type Box, boundsOfBox, centreOf, inflate, type Pt } from "./plan";
export {
  JUDGE_FRAMES,
  lighter,
  QUALITY_HIGH,
  QUALITY_LOW,
  QUALITY_MIN,
  type Quality,
  QualityGovernor,
  RECHECK_FRAMES,
  SLOW_FRAME_MS,
  STALL_MS,
  startQuality,
  VERY_SLOW_FRAME_MS,
  WARMUP_FRAMES,
} from "./quality";
export { type Device, type RackScene, rackScene, rowOf } from "./rack";
export {
  OU_M,
  RACK_BASE_M,
  type RackKind,
  type RackSet,
  TANK_HEIGHT_M,
  U_M,
  unitMOf,
} from "./racks";
export {
  BUSWAY_Y,
  backWall,
  boundsOfScene,
  insetOutline,
  insideScene,
  outlineOfScene,
  type Pipe,
  type Pod,
  RAISED_FLOOR_M,
  ROOM_HEIGHT_M,
  type RoomScene,
  type Row,
  rectsOfScene,
  roomScene,
} from "./room";
export {
  coolingRoutes,
  type Line,
  MAX_LINES,
  networkRoutes,
  powerRoutes,
  type Routes,
} from "./routes";
export type { Car, ParkingLot, Tree } from "./scatter";
export {
  ghostBox,
  outlinesOf,
  type PlanBox,
  type PlanGhost,
  type PlanHandle,
  type PlanShape,
  shapesOf,
} from "./select";
export {
  type BuildingInfo,
  type ParcelInfo,
  type SiteScene,
  siteScene,
  type Yard,
  type YardItem,
  type YardKind,
} from "./site";
export { type Spot, spotOf } from "./spot";
