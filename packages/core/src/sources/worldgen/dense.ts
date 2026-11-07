/**
 * Dense racks (REQ-107, ADR-0130): the racks of GPU servers, and the racks a liquid-cooling choice builds even without any
 * GPU. What a choice of the accelerator, power and cooling ladders asks of a room is worked out here: which rack, which
 * server, how many to a rack and how many racks, so the room and the plan agree.
 */
import type { Catalog } from "@terrarium/core/catalog";
import type { ChipBuild } from "@terrarium/core/world";

export type LiquidMode = NonNullable<ChipBuild["liquid"]>;
export type PlantSpec = NonNullable<ChipBuild["power"]>;

/** The dense racks of a world: they take the last compute racks of its first room. */
export interface DenseSpec {
  readonly racks: number;
  readonly rack: string;
  /** A fixed server model; absent: the room's usual mix of compute servers. */
  readonly server?: string;
  readonly perRack: number;
  readonly pdu: string;
  readonly liquid?: LiquidMode;
  /** The servers carry GPUs (they are not hosts for services). */
  readonly gpu: boolean;
  /** The CDUs' standby pump is raised by an operator (`cdu_pump_switch`), not by the CDU: the liquid pod's large units. */
  readonly manualStandby?: boolean;
}

/** Share of a dense PDU the servers' peak may take (a busbar tap box is sized for it). */
export const DENSE_BUDGET = 0.97;
const DENSE_PDU = "rp-60kw-busbar";
/** Units of a rack the servers may take (the top of the rack is the ToR). */
const SERVER_UNITS = 40;

const RACK_OF: Record<LiquidMode | "air", string> = {
  air: "lr-52u-ai-air",
  rdhx: "aq-45u-rdhx",
  dlc: "aq-48u-dlc",
  immersion: "sm-tank-48u",
};

/** The GPU server that stands in a rack of this cooling, for a pod (the newest) or an ordinary GPU choice. */
export function gpuServerFor(mode: string, liquid: LiquidMode | undefined): string {
  if (liquid === "immersion") return "sm-4u-gpu-imm";
  if (liquid === "dlc") return mode === "pod" ? "ax-4u-b300-dlc" : "ax-4u-8gpu-dlc";
  return mode === "server" ? "srv-4u-gpu" : "ax-8u-h100-air";
}

/** The ordinary server a liquid rack holds when it holds no GPU. */
const PLAIN_OF: Record<LiquidMode, string | undefined> = {
  rdhx: undefined,
  dlc: "hc-r1u-dlc",
  immersion: "sm-2u-imm",
};

/** Servers that fit one rack by its power and its units. */
function perRackOf(catalog: Catalog, server: string, pdu: string): number {
  const s = catalog.getOf(server, "server");
  const byPower = Math.floor(
    (DENSE_BUDGET * (catalog.getOf(pdu, "pdu").capacityW - 350)) / s.maxPowerW,
  );
  return Math.max(1, Math.min(byPower, Math.floor(SERVER_UNITS / s.uHeight)));
}

/** The dense racks a build asks of the world, or undefined when it asks for none. */
export function denseOf(
  build: ChipBuild,
  computeRacks: number,
  catalog: Catalog,
): DenseSpec | undefined {
  const accel = build.accel;
  const liquid = build.liquid;
  if (!accel && !liquid) return undefined;
  const rack = RACK_OF[liquid ?? "air"];
  if (accel) {
    const server = gpuServerFor(accel.mode, liquid);
    const perRack = perRackOf(catalog, server, DENSE_PDU);
    return {
      racks: Math.ceil(accel.servers / perRack),
      rack,
      server,
      perRack,
      pdu: DENSE_PDU,
      ...(liquid ? { liquid } : {}),
      gpu: true,
      ...(accel.mode === "pod" ? { manualStandby: true } : {}),
    };
  }
  const server = liquid ? PLAIN_OF[liquid] : undefined;
  const perRack = server ? perRackOf(catalog, server, DENSE_PDU) : 12;
  return {
    racks: Math.max(2, Math.ceil(computeRacks / 10)),
    rack,
    ...(server ? { server } : {}),
    perRack,
    pdu: DENSE_PDU,
    ...(liquid ? { liquid } : {}),
    gpu: false,
  };
}
