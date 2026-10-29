/** core.catalog: equipment models (what a device is), as data (REQ-004, ADR-0007). */
export { BUILTIN_MODELS, DEFAULT_MODEL_BY_KIND } from "./builtin";
export { Catalog } from "./catalog";
export {
  type CduModel,
  type ChillerModel,
  type CoolingMethod,
  type CoolingModel,
  type EquipmentModel,
  type FloorStandingKind,
  GENERIC_VENDOR,
  type GeneratorModel,
  isRackMounted,
  type ModelKind,
  type ModelLook,
  manufacturerOf,
  type PanelModel,
  type PanelStyle,
  type PduModel,
  type PlantKind,
  panelCapacityW,
  type RackCooling,
  type RackModel,
  type RackMountedKind,
  type ServerModel,
  type StorageModel,
  type SwitchModel,
  type UpsModel,
} from "./models";
