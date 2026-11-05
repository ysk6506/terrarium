/** core.catalog: equipment models (what a device is), as data (REQ-004, ADR-0007). */
export { BUILTIN_MODELS, DEFAULT_MODEL_BY_KIND } from "./builtin";
export { Catalog } from "./catalog";
export { GPU_MODELS, type GpuGeneration, type GpuModel, gpuOf, plannedGpus } from "./gpus";
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
  mountOf,
  mountOfModel,
  type PanelModel,
  type PanelStyle,
  type PduModel,
  type PlantKind,
  panelCapacityW,
  RACK_STANDARD_LABELS,
  type RackCooling,
  type RackModel,
  type RackMountedKind,
  type RackStandard,
  type ServerModel,
  type StorageModel,
  type SwitchModel,
  type UpsModel,
} from "./models";
