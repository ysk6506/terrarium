/** core.spatial: pure geometry — location hints to coordinates, packing, footprints (REQ-012, REQ-013). */
export {
  bounds,
  cableLength,
  center,
  contains,
  distance,
  floorLevel,
  overlaps,
  type Point,
  type Rect,
  type Rotation,
  rotated,
  snap,
} from "./geometry";
export {
  asInt,
  DEFAULT_KEYS,
  EMPTY_HINT,
  extractHint,
  type FloorInfo,
  type HintKind,
  type LocationHint,
  type LocationKeys,
  parseFloorInfo,
  parseRackPosition,
  parseUnitSpan,
  roomKey,
} from "./hints";
export {
  DEFAULT_LAYOUT,
  type DeviceInput,
  type DevicePlacement,
  deriveRoomLayout,
  type EquipmentPlacement,
  type LayoutSpec,
  type RackInput,
  type RackPlacement,
  type RackSpot,
  type RoomLayout,
} from "./layout";
export {
  encodeOutline,
  normalizeOutline,
  type Outline,
  type OutlinePacking,
  outlineArea,
  outlineBounds,
  outlineFromLonLat,
  packInOutline,
  parseOutline,
  pointInOutline,
  rectInOutline,
} from "./outline";
export { type PackedItem, packShelves, type SizedItem } from "./packing";
export { assignSlots, type Slot } from "./slots";
