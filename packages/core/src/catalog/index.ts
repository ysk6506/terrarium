/** core.catalog: equipment models (what a device is), as data (REQ-004, ADR-0007). */
export { BUILTIN_MODELS, DEFAULT_MODEL_BY_KIND } from "./builtin";
export { Catalog } from "./catalog";
export {
  type CoolingModel,
  type EquipmentModel,
  type FloorStandingKind,
  isRackMounted,
  type ModelKind,
  type PanelModel,
  type PduModel,
  panelCapacityW,
  type RackMountedKind,
  type ServerModel,
  type StorageModel,
  type SwitchModel,
  type UpsModel,
} from "./models";
