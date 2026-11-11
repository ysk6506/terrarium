/** The numbers and tables of the power slots (REQ-113): device draw, conversion, protection, storage. Defaults are v1. */
import type { CurveSpec, ParamSpec } from "./types";

const p = (def: number, unit: string, min: number, max: number, ko: string): ParamSpec => ({
  default: def,
  unit,
  min,
  max,
  ko,
});

export const POWER_DEVICE = {
  capPerfExponent: p(
    0.4,
    "지수",
    0.05,
    2,
    "전력 캡을 걸 때 성능 = (남은 동적 전력 몫)의 이 제곱. 곡선이 있으면 곡선이 이겨요",
  ),
  capPerfFloor: p(0.1, "비율", 0, 1, "캡을 아무리 낮춰도 동적 전력 몫을 이 아래로는 안 쳐요"),
} as const;

export const POWER_CONVERSION = {
  powerFactor: p(0.95, "비율", 0.5, 1, "역률(패널 전류를 구할 때)"),
  transformerBaseC: p(55, "°C", 0, 100, "변압기가 무부하에서 향하는 온도"),
  transformerRiseC: p(
    40,
    "°C",
    0,
    150,
    "변압기가 부하율 100%에서 더 오르는 폭(부하율의 제곱에 비례)",
  ),
  transformerHotFaultC: p(60, "°C", 0, 200, "과열 고장이 변압기 목표 온도에 더하는 폭"),
  transformerOffC: p(40, "°C", 0, 100, "차단된 변압기가 식어 향하는 온도"),
  transformerTauS: p(150, "s", 1, 7200, "변압기 온도가 목표를 따라가는 시간 상수"),
  busNominalV: p(48, "V", 12, 800, "직류 버스의 정격 전압"),
  busDroopV: p(6, "V", 0, 50, "버스가 정격 전력일 때 전압이 처지는 폭(부하의 제곱에 비례)"),
  busDegradedV: p(44, "V", 0, 800, "이 아래면 버스 상태가 '주의'"),
  busDownV: p(40, "V", 0, 800, "이 아래면 버스가 죽은 것으로 보고 서버를 꺼요"),
} as const;

export const POWER_PROTECTION = {
  tripFactor: p(
    1.05,
    "배",
    1,
    3,
    "차단기가 용량의 이 배수를 넘는 걸음에 바로 떨어져요(곡선이 없을 때)",
  ),
  breakerCoolS: p(
    60,
    "s",
    1,
    36000,
    "트립 곡선을 쓸 때, 용량 이하에서 쌓인 열이 식는 시간(이 시간이면 0으로)",
  ),
  transformerTripC: p(105, "°C", 40, 250, "변압기가 보호 차단되는 온도"),
  transformerResetC: p(80, "°C", 20, 250, "차단된 변압기가 돌아오려면 내려가야 하는 온도"),
  autoTransferS: p(10, "s", 0, 600, "수전 한 줄이 끊긴 뒤 자동 전환까지 걸리는 시간"),
} as const;

export const POWER_STORAGE = {
  upsRechargePctPerS: p(0.05, "%/s", 0.001, 10, "UPS 배터리가 입력이 있을 때 충전되는 속도"),
  bbuRechargeMin: p(30, "분", 1, 1440, "랙 배터리가 완전히 충전되는 데 걸리는 시간"),
  bbuCellLossShare: p(0.25, "비율", 0, 1, "고장 난 셀 하나가 앗아 가는 용량 비율"),
  generatorMinLoadShare: p(
    0.1,
    "비율",
    0,
    1,
    "발전기가 가벼운 부하에서도 연료를 태우는 최소 부하율",
  ),
  generatorMaxLoadShare: p(1.2, "비율", 1, 3, "발전기 연료 소모를 셀 때 부하율의 상한"),
} as const;

export const POWER_DEVICE_CURVES = {
  utilCurve: {
    xUnit: "비율",
    yUnit: "비율",
    xMin: 0,
    xMax: 1,
    yMin: 0,
    yMax: 1,
    ko: "서버 사용률에 따른 전력: 대기와 최대 사이를 얼마나 쓰나(0=대기, 1=최대)",
    sample: [
      [0, 0],
      [1, 1],
    ],
  } satisfies CurveSpec,
  capPerfCurve: {
    xUnit: "비율",
    yUnit: "비율",
    xMin: 0,
    xMax: 1,
    yMin: 0,
    yMax: 1,
    ko: "전력 캡에 따른 성능: 동적 전력 가운데 남은 몫 → 처리량",
    sample: [
      [0.1, 0.398],
      [0.5, 0.758],
      [1, 1],
    ],
  } satisfies CurveSpec,
} as const;

export const POWER_CONVERSION_CURVES = {
  upsEfficiencyCurve: {
    xUnit: "비율",
    yUnit: "비율",
    xMin: 0,
    xMax: 1.5,
    yMin: 0.5,
    yMax: 1,
    ko: "UPS 부하율(용량 대비)에 따른 효율",
    sample: [
      [0, 0.95],
      [1, 0.95],
    ],
  } satisfies CurveSpec,
} as const;

export const POWER_PROTECTION_CURVES = {
  tripTimeCurve: {
    xUnit: "배",
    yUnit: "s",
    xMin: 1,
    xMax: 20,
    yMin: 0,
    yMax: 86400,
    ko: "용량 대비 부하 배수에 따라 차단기가 떨어지기까지 버티는 초(0이면 그 걸음에 바로)",
    sample: [
      [1.05, 86400],
      [1.5, 600],
      [3, 10],
      [6, 0],
    ],
  } satisfies CurveSpec,
} as const;

export const ENV_WEATHER = {
  defaultOutdoorC: p(25, "°C", -50, 70, "날씨 표도 시나리오 지시도 없을 때의 바깥 온도"),
} as const;

export const NETWORK_LINK = {
  catchUpFactor: p(10, "배", 1, 1000, "뒤처진 복제본이 1초에 따라잡는 지연의 초(복제 속도)"),
} as const;

export const PERF_SERVICE = {
  backlogCatchUp: p(2, "배", 1, 100, "멈췄던 서비스가 밀린 일을 쌓일 때보다 몇 배 빨리 따라잡나"),
} as const;
