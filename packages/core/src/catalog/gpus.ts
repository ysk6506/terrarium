/**
 * Accelerators (REQ-066): what a GPU *is*, apart from the server that carries it. Chip names and figures are the
 * real NVIDIA ones, because the people who use this talk about clusters by chip ("H100 farm", "B300 rows"); the
 * servers that carry them are built by fictional vendors, like every other built-in model. A server names its chip
 * through `gpuModel`; the older generic GPU servers leave it out because their accelerator is unspecified.
 *
 * `firm` says whether the figures come from a datasheet (true) or from reports and extrapolation (false).
 * Vera Rubin is `planned`: it is shown so a plan can name it, but no server carries it yet.
 */
import type { ServerModel } from "./models";

export type GpuGeneration = "Hopper" | "Blackwell" | "Rubin";

export interface GpuModel {
  readonly id: string;
  readonly name: string;
  readonly generation: GpuGeneration;
  /** `shipping` can be bought and racked now; `planned` is announced but not in racks yet. */
  readonly status: "shipping" | "planned";
  /** The year it is, or is expected to be, in racks. */
  readonly year: number;
  /** Memory per GPU, GiB as vendors print it (GB). */
  readonly memoryGiB: number;
  readonly memoryType: "HBM3" | "HBM3e" | "HBM4";
  /** Memory bandwidth per GPU, TB/s. */
  readonly memoryTBps: number;
  /** Board power of one GPU in an 8-GPU HGX server, W. */
  readonly tdpW: number;
  /** NVLink bandwidth per GPU, GB/s (both directions). */
  readonly nvlinkGBps: number;
  /** The network card that comes with each GPU on the scale-out network. */
  readonly nic: { readonly name: string; readonly gbps: number };
  /** Whether the figures are from a datasheet (true) or reported / extrapolated (false). */
  readonly firm: boolean;
}

export const GPU_MODELS: readonly GpuModel[] = [
  {
    id: "h100-sxm",
    name: "NVIDIA H100 SXM5 80GB",
    generation: "Hopper",
    status: "shipping",
    year: 2023,
    memoryGiB: 80,
    memoryType: "HBM3",
    memoryTBps: 3.35,
    tdpW: 700,
    nvlinkGBps: 900,
    nic: { name: "ConnectX-7", gbps: 400 },
    firm: true,
  },
  {
    id: "h200-sxm",
    name: "NVIDIA H200 SXM 141GB",
    generation: "Hopper",
    status: "shipping",
    year: 2024,
    memoryGiB: 141,
    memoryType: "HBM3e",
    memoryTBps: 4.8,
    tdpW: 700,
    nvlinkGBps: 900,
    nic: { name: "ConnectX-7", gbps: 400 },
    firm: true,
  },
  {
    id: "b200-sxm",
    name: "NVIDIA B200 180GB",
    generation: "Blackwell",
    status: "shipping",
    year: 2025,
    memoryGiB: 180,
    memoryType: "HBM3e",
    memoryTBps: 8,
    tdpW: 1000,
    nvlinkGBps: 1800,
    nic: { name: "ConnectX-7", gbps: 400 },
    firm: true,
  },
  {
    id: "b300-sxm",
    name: "NVIDIA B300 288GB",
    generation: "Blackwell",
    status: "shipping",
    year: 2025,
    memoryGiB: 288,
    memoryType: "HBM3e",
    memoryTBps: 8,
    tdpW: 1100,
    nvlinkGBps: 1800,
    nic: { name: "ConnectX-8", gbps: 800 },
    firm: true,
  },
  {
    id: "rubin",
    name: "NVIDIA Vera Rubin (Rubin GPU)",
    generation: "Rubin",
    status: "planned",
    year: 2027,
    memoryGiB: 288,
    memoryType: "HBM4",
    memoryTBps: 13,
    tdpW: 1800,
    nvlinkGBps: 3600,
    nic: { name: "ConnectX-9", gbps: 1600 },
    firm: false,
  },
];

/** The accelerator a server carries; undefined when the model says nothing about it or has no GPU. */
export function gpuOf(model: Pick<ServerModel, "gpuModel">): GpuModel | undefined {
  return GPU_MODELS.find((g) => g.id === model.gpuModel);
}

/** Accelerators that are announced but not in racks yet. */
export const plannedGpus = (): readonly GpuModel[] =>
  GPU_MODELS.filter((g) => g.status === "planned");
