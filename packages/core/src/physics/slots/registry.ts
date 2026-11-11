/**
 * The registry of the physics slots (REQ-113, ADR-0137, docs/design-docs/physics-laws.md): thirteen ids cover the fourteen
 * places physics touches (room air and rack inlet share `thermal.room`). Each slot has a Korean name, the places an override
 * may name, a contract (input and output with units), what its v1 model does, its named numbers and its tables.
 * The engine reads its numbers and tables from here, through the resolved profile (`resolved.ts`).
 */
import { HAZARD_ROWS } from "./hazard-table";
import {
  ENV_WEATHER,
  NETWORK_LINK,
  PERF_SERVICE,
  POWER_CONVERSION,
  POWER_CONVERSION_CURVES,
  POWER_DEVICE,
  POWER_DEVICE_CURVES,
  POWER_PROTECTION,
  POWER_PROTECTION_CURVES,
  POWER_STORAGE,
} from "./params-power";
import {
  COOLING_LIQUID,
  COOLING_PLANT,
  COOLING_PLANT_CURVES,
  COOLING_UNIT,
  COOLING_UNIT_CURVES,
  THERMAL_DEVICE,
  THERMAL_ROOM,
} from "./params-thermal";
import type { FieldSpec, ParamSpec, ParamTable, SlotId, SlotSpec } from "./types";

type ValuesOf<T> = { readonly [K in keyof T]: number };

/** The numbers of a slot, by name; what the engine reads. */
export interface SlotValues {
  readonly "thermal.room": ValuesOf<typeof THERMAL_ROOM>;
  readonly "thermal.device": ValuesOf<typeof THERMAL_DEVICE>;
  readonly "cooling.unit": ValuesOf<typeof COOLING_UNIT>;
  readonly "cooling.liquid": ValuesOf<typeof COOLING_LIQUID>;
  readonly "cooling.plant": ValuesOf<typeof COOLING_PLANT>;
  readonly "env.weather": ValuesOf<typeof ENV_WEATHER>;
  readonly "power.device": ValuesOf<typeof POWER_DEVICE>;
  readonly "power.conversion": ValuesOf<typeof POWER_CONVERSION>;
  readonly "power.protection": ValuesOf<typeof POWER_PROTECTION>;
  readonly "power.storage": ValuesOf<typeof POWER_STORAGE>;
  readonly "reliability.hazard": Readonly<Record<string, number>>;
  readonly "network.link": ValuesOf<typeof NETWORK_LINK>;
  readonly "perf.service": ValuesOf<typeof PERF_SERVICE>;
}

const f = (name: string, unit: string, ko: string): FieldSpec => ({ name, unit, ko });

/** One named number per fault kind (hours between failures of one piece of equipment), and a scale on all of them. */
const HAZARD: ParamTable = {
  rateScale: {
    default: 1,
    unit: "배",
    min: 0.01,
    max: 100,
    ko: "모든 고장률에 곱하는 배수(2면 고장이 두 배 자주 나요)",
  },
  ...Object.fromEntries(
    HAZARD_ROWS.map((r): [string, ParamSpec] => [
      `mtbf.${r.type}`,
      {
        default: r.hours,
        unit: "시간",
        min: 1,
        max: 10_000_000,
        ko: `${r.kinds.join("·")} 한 대가 '${r.type}'를 겪기까지 평균 세계 시간`,
      },
    ]),
  ),
};

const ALL: readonly SlotSpec[] = [
  {
    id: "thermal.room",
    ko: "방 공기와 랙 흡기",
    scopes: ["world", "building", "room", "rack"],
    input: [
      f("heatW", "W", "랙·UPS·CDU가 공기로 내놓은 열"),
      f("supplyC", "°C", "냉방기별 급기 온도"),
      f("capacityW", "W", "냉방기별 능력"),
      f("outdoorC", "°C", "바깥 온도"),
      f("areaM2", "m²", "방 면적"),
    ],
    output: [
      f("roomC", "°C", "방 온도"),
      f("inletC", "°C", "랙별 흡기 온도"),
      f("removedW", "W", "냉방기별 뺀 열"),
    ],
    v1: "방 하나가 온도 하나인 덩어리. 들어온 열 − 냉방 − 벽 손실을 열용량으로 나눠 한 걸음씩 더하고, 흡기는 급기 + 섞임 × (방 − 급기).",
    params: THERMAL_ROOM,
    curves: {},
  },
  {
    id: "thermal.device",
    ko: "칩 온도",
    scopes: ["world", "model", "rack", "room", "building"],
    input: [f("inletC", "°C", "흡기 온도"), f("powerW", "W", "전력"), f("util", "비율", "부하")],
    output: [f("chipC", "°C", "칩 온도"), f("fanRpm", "rpm", "팬 회전수")],
    v1: "흡기 + 열 상승폭 × (0.35 + 0.65 × 부하)로 향하고 30초 시정수로 따라가요. 팬은 칩 온도를 따라 돌아요. 팬 전력과 누설 전력은 없어요(v2).",
    params: THERMAL_DEVICE,
    curves: {},
  },
  {
    id: "cooling.unit",
    ko: "냉방기",
    scopes: ["world", "model", "room", "building"],
    input: [
      f("returnC", "°C", "환기 온도"),
      f("setpointC", "°C", "설정 온도"),
      f("outdoorC", "°C", "바깥 온도"),
    ],
    output: [f("capacityW", "W", "능력"), f("powerW", "W", "전력")],
    v1: "설정보다 더운 만큼 비례해 열을 빼요(능력까지). 압축기 전력은 뺀 열 ÷ 3이에요.",
    params: COOLING_UNIT,
    curves: COOLING_UNIT_CURVES,
  },
  {
    id: "cooling.liquid",
    ko: "액체 냉각",
    scopes: ["world", "model", "rack", "room", "building"],
    input: [
      f("powerW", "W", "랙 전력"),
      f("supplyC", "°C", "급수 온도"),
      f("flowOk", "참/거짓", "유량 상태"),
    ],
    output: [
      f("liquidW", "W", "액체로 간 열"),
      f("coolantC", "°C", "냉각수 온도"),
      f("bathC", "°C", "욕조 온도"),
    ],
    v1: "서버마다 액체로 가는 몫, 리어도어 75%, 침지 탱크는 열용량 하나. 유량과 이슬점은 없어요(v2).",
    params: COOLING_LIQUID,
    curves: {},
  },
  {
    id: "cooling.plant",
    ko: "열원 플랜트",
    scopes: ["world", "model", "building"],
    input: [f("loadKw", "kW", "부하"), f("outdoorC", "°C", "바깥 온도")],
    output: [
      f("capacityKw", "kW", "능력"),
      f("supplyC", "°C", "급수 온도"),
      f("powerW", "W", "전력"),
    ],
    v1: "CDU 루프는 물 열용량으로 온도가 변하고, 칠러·드라이쿨러·냉각탑은 바깥 온도에 직선으로 능력이 줄어요.",
    params: COOLING_PLANT,
    curves: COOLING_PLANT_CURVES,
  },
  {
    id: "env.weather",
    ko: "바깥 날씨",
    scopes: ["world"],
    input: [f("timeS", "s", "시각")],
    output: [f("outdoorC", "°C", "바깥 온도"), f("humidityPct", "%", "습도")],
    v1: "값 하나로 고정(25 °C). 날씨 표(CSV)를 주면 시각에 따라 보간해요. 시나리오가 바꾼 값이 표보다 앞서요.",
    params: ENV_WEATHER,
    curves: {},
  },
  {
    id: "power.device",
    ko: "장비 전력",
    scopes: ["world", "model", "rack", "room", "building"],
    input: [f("util", "비율", "부하"), f("capW", "W", "캡")],
    output: [f("powerW", "W", "전력"), f("perf", "비율", "성능")],
    v1: "대기 + (최대 − 대기) × 부하의 직선. 캡을 걸면 성능 = 남은 동적 전력 몫의 0.4제곱.",
    params: POWER_DEVICE,
    curves: POWER_DEVICE_CURVES,
  },
  {
    id: "power.conversion",
    ko: "전력 변환",
    scopes: ["world", "model", "building"],
    input: [f("loadRatio", "비율", "부하율")],
    output: [f("efficiency", "비율", "효율"), f("lossW", "W", "손실 열")],
    v1: "UPS 효율은 모델마다 하나, 역률 0.95, 변압기 온도는 55 + 40 × 부하율².",
    params: POWER_CONVERSION,
    curves: POWER_CONVERSION_CURVES,
  },
  {
    id: "power.protection",
    ko: "보호(차단기)",
    scopes: ["world", "model", "building", "room"],
    input: [f("loadRatio", "배", "부하 ÷ 용량"), f("heldS", "s", "이어진 시간")],
    output: [f("secondsToTrip", "s", "떨어질 때까지 남은 시간")],
    v1: "용량의 1.05배를 넘으면 그 걸음에 바로 떨어져요(0초). 트립 곡선을 주면 과부하 크기에 따라 버티는 시간이 달라져요.",
    params: POWER_PROTECTION,
    curves: POWER_PROTECTION_CURVES,
  },
  {
    id: "power.storage",
    ko: "저장(배터리·발전기)",
    scopes: ["world", "model", "rack", "building"],
    input: [f("loadW", "W", "부하"), f("chargePct", "%", "충전량")],
    output: [f("chargePct", "%", "새 충전량"), f("runtimeMin", "분", "남은 시간")],
    v1: "배터리는 에너지를 직선으로 쓰고 일정하게 충전해요. 발전기는 시동 시간과 부하에 비례한 연료. 퓨커트와 노화는 없어요(v2).",
    params: POWER_STORAGE,
    curves: {},
  },
  {
    id: "reliability.hazard",
    ko: "고장률",
    scopes: ["world"],
    input: [f("kind", "종류", "장비 종류")],
    output: [f("ratePerHour", "1/시간", "고장 종류별 시간당 고장률")],
    v1: "고장 종류마다 평균 고장 간격(MTBF) 하나, 일정한 확률. 온도·나이·같은 랙의 영향은 없어요(v2).",
    params: HAZARD,
    curves: {},
  },
  {
    id: "network.link",
    ko: "회선",
    scopes: ["world"],
    input: [f("distanceKm", "km", "거리")],
    output: [f("latencyMs", "ms", "지연"), f("lagS", "s", "복제 지연")],
    v1: "편도 지연 = 1 + 거리 ÷ 50 ms(세계를 만들 때 정해져요). 복제가 따라잡는 속도는 10배 고정이고 이 숫자만 바꿀 수 있어요.",
    params: NETWORK_LINK,
    curves: {},
  },
  {
    id: "perf.service",
    ko: "일의 속도",
    scopes: ["world"],
    input: [f("util", "비율", "사용률"), f("perf", "비율", "성능 계수")],
    output: [f("backlog", "건", "밀린 일")],
    v1: "캡·스로틀이 성능을 깎고, 밀린 일은 쌓인 속도의 2배로 따라잡아요. 대기 행렬 응답 곡선은 없어요(v2).",
    params: PERF_SERVICE,
    curves: {},
  },
];

export const SLOTS: Readonly<Record<SlotId, SlotSpec>> = Object.fromEntries(
  ALL.map((s) => [s.id, s]),
) as Record<SlotId, SlotSpec>;

/** The default value of every number of a slot. */
export function defaultsOf<S extends SlotId>(slot: S): SlotValues[S] {
  return Object.fromEntries(
    Object.entries(SLOTS[slot].params).map(([k, v]) => [k, v.default]),
  ) as unknown as SlotValues[S];
}

/** Split `slot.param` or `slot.curve` into the slot and the name, or undefined when no slot has that prefix. */
export function splitName(full: string): { slot: SlotId; name: string } | undefined {
  for (const slot of Object.keys(SLOTS) as SlotId[])
    if (full.startsWith(`${slot}.`) && full.length > slot.length + 1)
      return { slot, name: full.slice(slot.length + 1) };
  return undefined;
}
