/** Equipment models: what a device *is* (REQ-004). Behaviour differences between product versions live in profiles. */

export type RackMountedKind = "server" | "switch" | "storage" | "pdu";
export type FloorStandingKind = "cooling_unit" | "power_panel" | "ups";
export type ModelKind = RackMountedKind | FloorStandingKind;

interface BaseModel {
  readonly id: string;
  readonly kind: ModelKind;
  readonly name: string;
  readonly description: string;
  /** Purchase cost in millions of KRW, shown in the builder's budget HUD. */
  readonly costM: number;
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
  readonly manufacturer: string;
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
}

export interface PanelModel extends BaseModel {
  readonly kind: "power_panel";
  readonly footprint: { readonly w: number; readonly d: number };
  readonly capacityA: number;
  readonly voltage: number;
  readonly breakers: number;
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
  | UpsModel;

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
