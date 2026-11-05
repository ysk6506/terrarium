/**
 * OCP Open Rack v3 (ORv3) equipment (REQ-063, ADR-0060): the rack, the power shelves that feed its 48 V
 * busbar, and sleds and a switch built for its 21-inch bay. A sled has no power supplies of its own, so
 * it has one busbar input where a 19-inch server has two cords. The vendor is fictional like all others;
 * the numbers follow the public ORv3 and ORv3 HPR descriptions (48 OU of 48 mm, 18 kW or 33 kW shelves).
 */
import type { PduModel, RackModel, ServerModel, SwitchModel } from "../models";
import { STYLE } from "./look";

const MAKER = { vendor: "OpenFrame Works", series: "OF-R3" } as const;

export const ORV3_RACKS: readonly RackModel[] = [
  {
    ...MAKER,
    id: "orv3-48ou-std",
    kind: "rack",
    name: "OF-R3 ORv3 랙 48OU",
    description: "OCP Open Rack v3 표준형, 21인치, 48V 버스바, 공랭 36kW",
    costM: 7,
    look: STYLE.openframe("mesh"),
    uHeight: 48,
    footprint: { w: 0.6, d: 1.068 },
    cooling: "air",
    maxKw: 36,
    form: "rack",
    fluidLitres: 0,
    standard: "orv3",
  },
  {
    ...MAKER,
    id: "orv3-48ou-hpr-dlc",
    kind: "rack",
    name: "OF-R3H ORv3 HPR 랙 48OU 수랭",
    description: "ORv3 고출력(HPR), 33kW 셸프 3개, 직접 수랭 92kW",
    costM: 28,
    look: STYLE.openframe("flat"),
    uHeight: 48,
    footprint: { w: 0.6, d: 1.2 },
    cooling: "dlc",
    maxKw: 92,
    form: "rack",
    fluidLitres: 0,
    standard: "orv3",
  },
];

/** Power shelves: they take three-phase AC in and put 48 V on the busbar. */
export const ORV3_SHELVES: readonly PduModel[] = [
  {
    ...MAKER,
    id: "orv3-shelf-18kw",
    kind: "pdu",
    name: "OF-R3 파워 셸프 18kW (1OU)",
    description: "3kW 정류기 6개, ORv3 48V 버스바 급전",
    costM: 8,
    look: STYLE.openframe("flat"),
    uHeight: 1,
    capacityW: 18_000,
    outlets: 0,
    mount: "orv3",
    shelf: true,
  },
  {
    ...MAKER,
    id: "orv3-shelf-33kw",
    kind: "pdu",
    name: "OF-R3H 파워 셸프 33kW (1OU)",
    description: "ORv3 HPR용, 5.5kW 정류기 6개, 3상",
    costM: 14,
    look: STYLE.openframe("flat"),
    uHeight: 1,
    capacityW: 33_000,
    outlets: 0,
    mount: "orv3",
    shelf: true,
  },
];

export const ORV3_SWITCHES: readonly SwitchModel[] = [
  {
    ...MAKER,
    id: "orv3-tor-32x100g",
    kind: "switch",
    name: "OF-R3 ToR 32x100G (1OU)",
    description: "ORv3 21인치 베이용 리프 스위치",
    costM: 30,
    look: STYLE.openframe("ports"),
    uHeight: 1,
    ports: 32,
    portSpeedGbps: 100,
    powerW: 450,
    role: "tor",
    mount: "orv3",
  },
];

type Sled = Omit<ServerModel, "kind" | "cooling" | "liquidShare" | "coolantRiseC" | "mount"> &
  Partial<Pick<ServerModel, "cooling" | "liquidShare" | "coolantRiseC">>;
const sled = (spec: Sled): ServerModel => ({
  kind: "server",
  cooling: "air",
  liquidShare: 0,
  coolantRiseC: 0,
  mount: "orv3",
  ...spec,
});

export const ORV3_SERVERS: readonly ServerModel[] = [
  sled({
    ...MAKER,
    id: "orv3-cpu-1ou",
    name: "OF-R3 컴퓨트 슬레드 1OU",
    description: "2소켓 컴퓨트, 전원 모듈 없이 버스바 직결",
    costM: 13,
    look: STYLE.openframe("mesh"),
    uHeight: 1,
    idlePowerW: 130,
    maxPowerW: 700,
    psuCount: 1,
    fanCount: 4,
    cpuSockets: 2,
    coresPerSocket: 48,
    memoryGiB: 1024,
    gpus: 0,
    maxInletC: 35,
    thermalRiseC: 38,
    cpuThrottleC: 90,
    cpuShutdownC: 100,
  }),
  sled({
    ...MAKER,
    id: "orv3-gpu-2ou",
    name: "OF-R3 GPU 슬레드 2OU (공랭)",
    description: "GPU 4장, 공랭, 버스바 직결",
    costM: 190,
    look: STYLE.openframe("gpu-grille"),
    uHeight: 2,
    idlePowerW: 480,
    maxPowerW: 3200,
    psuCount: 1,
    fanCount: 8,
    cpuSockets: 2,
    coresPerSocket: 32,
    memoryGiB: 1024,
    gpus: 4,
    maxInletC: 30,
    thermalRiseC: 44,
    cpuThrottleC: 88,
    cpuShutdownC: 98,
  }),
  sled({
    ...MAKER,
    id: "orv3-gpu-2ou-dlc",
    name: "OF-R3L GPU 슬레드 2OU (수랭)",
    description: "GPU 4장, 직접 수랭, HPR 랙용",
    costM: 250,
    look: STYLE.openframe("gpu-grille"),
    uHeight: 2,
    idlePowerW: 520,
    maxPowerW: 3800,
    psuCount: 1,
    fanCount: 4,
    cpuSockets: 2,
    coresPerSocket: 32,
    memoryGiB: 1024,
    gpus: 4,
    maxInletC: 40,
    thermalRiseC: 20,
    cpuThrottleC: 88,
    cpuShutdownC: 98,
    cooling: "dlc",
    liquidShare: 0.75,
    coolantRiseC: 26,
  }),
];
