/**
 * 8-GPU HGX-class servers by accelerator generation (REQ-066, ADR-0063): H100, H200, B200, B300. The chassis are
 * built by a fictional vendor; the chip, its count, and the power and price follow what the real servers are
 * listed at (docs/design-docs/real-prices.md). Prices are millions of KRW at 1 USD = 1,343 KRW.
 */
import type { ServerModel } from "../models";
import { STYLE } from "./look";
import { server } from "./servers";

const AX_H = { vendor: "Aerion AI", series: "AX-H" } as const;
const AX_B = { vendor: "Aerion AI", series: "AX-B" } as const;

/** What every air-cooled 8-GPU HGX box shares: two sockets, 2 TiB of memory, six power supplies. */
const HGX_AIR = {
  psuCount: 6,
  cpuSockets: 2,
  gpus: 8,
  maxInletC: 30,
  cpuThrottleC: 88,
  cpuShutdownC: 98,
} as const;

export const GPU_SERVERS: readonly ServerModel[] = [
  server({
    ...AX_H,
    ...HGX_AIR,
    id: "ax-8u-h100-air",
    name: "AX-H100 8U GPU 8장 (공랭)",
    description: "H100 SXM 80GB 8장, NVLink 900GB/s, 400G NIC 8개",
    costM: 400,
    look: STYLE.aerion("gpu-grille"),
    gpuModel: "h100-sxm",
    uHeight: 8,
    idlePowerW: 1300,
    maxPowerW: 10200,
    fanCount: 12,
    coresPerSocket: 56,
    memoryGiB: 2048,
    thermalRiseC: 46,
  }),
  server({
    ...AX_H,
    ...HGX_AIR,
    id: "ax-8u-h200-air",
    name: "AX-H200 8U GPU 8장 (공랭)",
    description: "H200 SXM 141GB 8장, NVLink 900GB/s, 400G NIC 8개",
    costM: 535,
    look: STYLE.aerion("gpu-grille"),
    gpuModel: "h200-sxm",
    uHeight: 8,
    idlePowerW: 1300,
    maxPowerW: 10200,
    fanCount: 12,
    coresPerSocket: 56,
    memoryGiB: 2048,
    thermalRiseC: 46,
  }),
  server({
    ...AX_B,
    ...HGX_AIR,
    id: "ax-10u-b200-air",
    name: "AX-B200 10U GPU 8장 (공랭)",
    description: "B200 180GB 8장, NVLink 1.8TB/s, 400G NIC 8개",
    costM: 635,
    look: STYLE.aerion("gpu-grille"),
    gpuModel: "b200-sxm",
    uHeight: 10,
    idlePowerW: 2000,
    maxPowerW: 14300,
    fanCount: 14,
    coresPerSocket: 56,
    memoryGiB: 2048,
    thermalRiseC: 50,
  }),
  server({
    ...AX_B,
    ...HGX_AIR,
    id: "ax-8u-b300-air",
    name: "AX-B300 8U GPU 8장 (공랭)",
    description: "B300 288GB 8장, NVLink 1.8TB/s, 800G NIC 8개",
    costM: 880,
    look: STYLE.aerion("gpu-grille"),
    gpuModel: "b300-sxm",
    uHeight: 8,
    idlePowerW: 1900,
    maxPowerW: 14000,
    fanCount: 12,
    coresPerSocket: 64,
    memoryGiB: 2048,
    thermalRiseC: 50,
  }),
  server({
    vendor: "Aerion AI",
    series: "AX-BL",
    id: "ax-4u-b300-dlc",
    name: "AX-B300L 4U GPU 8장 (수랭)",
    description: "B300 288GB 8장, 콜드플레이트 직접 수랭, 800G NIC 8개",
    costM: 940,
    look: STYLE.aerion("gpu-grille"),
    gpuModel: "b300-sxm",
    uHeight: 4,
    idlePowerW: 2200,
    maxPowerW: 14500,
    psuCount: 6,
    fanCount: 6,
    cpuSockets: 2,
    coresPerSocket: 64,
    memoryGiB: 2048,
    gpus: 8,
    maxInletC: 40,
    thermalRiseC: 20,
    cpuThrottleC: 88,
    cpuShutdownC: 98,
    cooling: "dlc",
    liquidShare: 0.85,
    coolantRiseC: 24,
  }),
];
