/** Equipment models: what a device *is* (REQ-004). Behaviour differences between product versions live in profiles. */

export type RackMountedKind = "server" | "switch" | "storage" | "pdu";
export type FloorStandingKind = "cooling_unit" | "power_panel" | "ups" | "cdu";
/** Equipment that stands outdoors or in a plant room rather than on a data-hall floor. */
export type PlantKind = "chiller" | "generator";
export type ModelKind = RackMountedKind | FloorStandingKind | PlantKind | "rack";

/** How a server (or the rack that holds it) gets rid of heat (REQ-044). */
export type CoolingMethod = "air" | "dlc" | "immersion";
/** How a rack is cooled: air, air with a rear-door heat exchanger, direct liquid, or a tank of fluid. */
export type RackCooling = "air" | "rdhx" | CoolingMethod;

/** What a model looks like in 3D (REQ-045): the view reads this and nothing else about vendors. */
export interface ModelLook {
  /** Body colour, "#rrggbb". */
  readonly body: string;
  /** Accent colour of bezels, handles and status lights. */
  readonly accent: string;
  readonly finish: "matte" | "metal" | "glossy";
  /** The front face: what a person sees looking at the device. */
  readonly front: "mesh" | "bezel" | "drive-bays" | "gpu-grille" | "ports" | "flat";
}

interface BaseModel {
  readonly id: string;
  readonly kind: ModelKind;
  readonly name: string;
  readonly description: string;
  /** Purchase cost in millions of KRW, shown in the builder's budget HUD. */
  readonly costM: number;
  /** Who makes it. All built-in vendors are fictional; imports keep the real name as a property. */
  readonly vendor: string;
  readonly series: string;
  readonly look: ModelLook;
}

export interface ServerModel extends BaseModel {
  readonly kind: "server";
  readonly uHeight: number;
  readonly idlePowerW: number;
  readonly maxPowerW: number;
  readonly psuCount: number;
  readonly fanCount: number;
  readonly cpuSockets: number;
  readonly coresPerSocket: number;
  readonly memoryGiB: number;
  readonly gpus: number;
  /** Highest allowed inlet temperature (ASHRAE class), °C. */
  readonly maxInletC: number;
  /** CPU temperature above inlet at full load with all fans working, °C. */
  readonly thermalRiseC: number;
  readonly cpuThrottleC: number;
  readonly cpuShutdownC: number;
  /** air: fans only. dlc: cold plates carry `liquidShare` of the heat. immersion: the fluid carries nearly all. */
  readonly cooling: CoolingMethod;
  /** Share of the heat that leaves through liquid (0 for air). */
  readonly liquidShare: number;
  /** CPU temperature above the coolant supply at full load (liquid-cooled models), °C. */
  readonly coolantRiseC: number;
}

export interface SwitchModel extends BaseModel {
  readonly kind: "switch";
  readonly uHeight: number;
  readonly ports: number;
  readonly portSpeedGbps: number;
  readonly powerW: number;
  readonly role: "tor" | "spine" | "mgmt";
}

export interface StorageModel extends BaseModel {
  readonly kind: "storage";
  readonly uHeight: number;
  readonly capacityTiB: number;
  readonly disks: number;
  readonly powerW: number;
}

export interface PduModel extends BaseModel {
  readonly kind: "pdu";
  /** 0 for vertical PDUs mounted at the back of the rack. */
  readonly uHeight: number;
  readonly capacityW: number;
  readonly outlets: number;
}

export interface CoolingModel extends BaseModel {
  readonly kind: "cooling_unit";
  readonly footprint: { readonly w: number; readonly d: number };
  readonly capacityKw: number;
  readonly fanPowerW: number;
  readonly minSetpointC: number;
  readonly maxSetpointC: number;
  readonly style: "crah" | "inrow";
  /** Needs chilled water from a plant (true) or has its own compressor (false). */
  readonly chilledWater: boolean;
}

/** A rack, a rear-door-cooled rack, a liquid-cooled rack with manifolds, or an immersion tank. */
export interface RackModel extends BaseModel {
  readonly kind: "rack";
  readonly uHeight: number;
  readonly footprint: { readonly w: number; readonly d: number };
  readonly cooling: RackCooling;
  /** Most heat the rack is designed to handle, kW. */
  readonly maxKw: number;
  readonly form: "rack" | "tank";
  /** Fluid in a tank, litres (0 for racks). */
  readonly fluidLitres: number;
}

/** Coolant distribution unit: moves heat from the rack loop to the facility water. */
export interface CduModel extends BaseModel {
  readonly kind: "cdu";
  readonly footprint: { readonly w: number; readonly d: number };
  readonly capacityKw: number;
  /** Pumps installed; one is spare, so losing one costs nothing and losing two costs capacity. */
  readonly pumps: number;
  readonly pumpPowerW: number;
  /** Coolant supply to the racks, °C: where it is set and what it may be set to. */
  readonly supplySetpointC: number;
  readonly minSupplyC: number;
  readonly maxSupplyC: number;
  /** Coolant held in the loop, litres: more of it means slower warming when cooling is lost. */
  readonly loopLitres: number;
}

/** A plant that makes chilled or warm water for cooling units and CDUs. */
export interface ChillerModel extends BaseModel {
  readonly kind: "chiller";
  readonly plant: "chiller" | "dry_cooler" | "cooling_tower";
  readonly footprint: { readonly w: number; readonly d: number };
  readonly capacityKw: number;
  /** Water temperature it makes, °C. */
  readonly supplySetpointC: number;
  /** Electric power per kW of heat removed (compressors, fans, pumps). */
  readonly powerPerKw: number;
  /** Water held in the loop and buffer tank, m³. */
  readonly bufferM3: number;
}

/** What a "panel" is: distribution board, main switchgear, overhead busway, transfer switch or transformer. */
export type PanelStyle = "panel" | "switchgear" | "busway" | "ats" | "transformer";

export interface PanelModel extends BaseModel {
  readonly kind: "power_panel";
  readonly footprint: { readonly w: number; readonly d: number };
  readonly capacityA: number;
  readonly voltage: number;
  readonly breakers: number;
  readonly style: PanelStyle;
}

/** A diesel generator set that takes over when the grid is lost. */
export interface GeneratorModel extends BaseModel {
  readonly kind: "generator";
  readonly footprint: { readonly w: number; readonly d: number };
  readonly capacityKw: number;
  /** Seconds from the start signal to taking load. */
  readonly startSeconds: number;
  /** Fuel in the tank, litres, and how much it burns per hour at full load. */
  readonly fuelLitres: number;
  readonly burnLitresPerHour: number;
}

export interface UpsModel extends BaseModel {
  readonly kind: "ups";
  readonly footprint: { readonly w: number; readonly d: number };
  readonly capacityKw: number;
  readonly batteryKwh: number;
  readonly efficiency: number;
}

export type EquipmentModel =
  | ServerModel
  | SwitchModel
  | StorageModel
  | PduModel
  | CoolingModel
  | PanelModel
  | UpsModel
  | RackModel
  | CduModel
  | ChillerModel
  | GeneratorModel;

export function isRackMounted(
  model: EquipmentModel,
): model is ServerModel | SwitchModel | StorageModel | PduModel {
  return (
    model.kind === "server" ||
    model.kind === "switch" ||
    model.kind === "storage" ||
    model.kind === "pdu"
  );
}

/** Three-phase power capacity of a panel in watts (power factor 0.95). */
export function panelCapacityW(model: PanelModel): number {
  return Math.sqrt(3) * model.voltage * model.capacityA * 0.95;
}

/** The vendor name a protocol shows (Redfish `Manufacturer`): the built-in baseline models are "Terrarium Systems". */
export const manufacturerOf = (model: EquipmentModel): string =>
  model.vendor === GENERIC_VENDOR ? "Terrarium Systems" : model.vendor;

/** Vendor of the baseline models older worlds use. */
export const GENERIC_VENDOR = "범용(기본)";
