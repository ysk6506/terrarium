/** The numbers of the heat slots (REQ-113): room air, rack inlet, chip, cooling unit, liquid loops, plants. Defaults are v1, as written before slots existed. */
import type { CurveSpec, ParamSpec } from "./types";

const p = (def: number, unit: string, min: number, max: number, ko: string): ParamSpec => ({
  default: def,
  unit,
  min,
  max,
  ko,
});

export const THERMAL_ROOM = {
  envelopeWPerKM2: p(2, "W/(K·m²)", 0, 50, "방 바닥 1m²당 바깥과 열이 오가는 정도(벽·지붕 손실)"),
  coilDeltaC: p(12, "°C", 1, 40, "냉방 코일 최대 부하에서 공기가 식는 폭"),
  airJPerKM3: p(3600, "J/(K·m³)", 500, 20000, "방 부피당 열용량(공기와 안에 든 물건)"),
  roomHeightM: p(3, "m", 1, 20, "방 천장 높이"),
  fullLoadDeltaC: p(
    10,
    "°C",
    1,
    40,
    "냉방기가 능력만큼 열을 빼려면 방이 설정보다 얼마나 더워야 하나",
  ),
  roomMinC: p(5, "°C", -40, 40, "방 온도가 내려갈 수 있는 하한(계산 안전판)"),
  roomMaxC: p(75, "°C", 40, 150, "방 온도가 올라갈 수 있는 상한(계산 안전판)"),
  mixContained: p(0.12, "비율", 0, 1, "컨테인먼트 랙이 흡기에 섞어 마시는 방 공기 비율"),
  mixOpen: p(0.3, "비율", 0, 1, "개방 랙이 흡기에 섞어 마시는 방 공기 비율"),
  mixUnassigned: p(0.25, "비율", 0, 1, "전담 냉방기가 없는 랙이 더 섞어 마시는 비율"),
  inletHeatBiasCPerKw: p(0.02, "°C/kW", 0, 2, "랙 전력 1kW당 흡기가 급기보다 더 오르는 폭"),
  inletTauS: p(60, "s", 1, 3600, "랙 흡기 온도가 목표를 따라가는 시간 상수"),
  outletBaseRiseC: p(8, "°C", 0, 40, "랙 배기가 흡기보다 높은 기본 폭"),
  outletRiseCPerKw: p(0.4, "°C/kW", 0, 5, "공기로 나온 열 1kW당 배기가 더 오르는 폭"),
  outletMaxRiseC: p(25, "°C", 1, 60, "배기가 흡기보다 높을 수 있는 최대 폭"),
  cduHeatShare: p(0.04, "비율", 0, 0.5, "CDU 펌프가 방에 내놓는 열의 비율(부하 대비)"),
  rackUnitBiasC: p(0.03, "°C/U", 0, 1, "랙 아래칸에서 위칸으로 한 칸 오를 때 흡기가 오르는 폭"),
  rackUnitContainedShare: p(0.3, "비율", 0, 1, "컨테인먼트 안에서 위아래 차이가 줄어드는 비율"),
} as const;

export const THERMAL_DEVICE = {
  chipRiseBase: p(0.35, "비율", 0, 1, "서버가 놀 때도 칩이 흡기 위로 오르는 몫(열 상승폭의 비율)"),
  chipRiseLoad: p(0.65, "비율", 0, 1, "부하에 따라 더 오르는 몫(열 상승폭의 비율)"),
  chipTauS: p(30, "s", 1, 3600, "칩 온도가 목표를 따라가는 시간 상수"),
  fanFailPenalty: p(0.6, "비율", 0, 5, "팬이 전부 서면 칩 열 상승이 늘어나는 비율"),
  fanHeldPenalty: p(1.2, "비율", 0, 5, "팬을 낮게 묶어 둘 때(100% → 0%) 열 상승이 늘어나는 비율"),
  throttleHysteresisC: p(5, "°C", 0, 30, "스로틀이 풀리려면 스로틀 온도보다 이만큼 내려가야 해요"),
  fanRpmBase: p(3000, "rpm", 0, 20000, "팬 기본 회전수"),
  fanRpmPerC: p(120, "rpm/°C", 0, 2000, "칩 온도 1도당 팬이 더 도는 양"),
  fanRpmRefC: p(40, "°C", 0, 100, "팬이 기본 회전수를 넘어 돌기 시작하는 칩 온도"),
  fanRpmMax: p(16000, "rpm", 1000, 30000, "자동 제어가 낼 수 있는 팬 회전수 상한"),
  fanFailBoost: p(1.25, "배", 1, 3, "팬 하나가 멈추면 나머지가 더 도는 배수"),
  fanRpmCap: p(18000, "rpm", 1000, 40000, "팬 회전수 절대 상한"),
  gpuAirBaseC: p(26, "°C", 0, 60, "공랭 GPU가 흡기 위로 오르는 기본 폭"),
  gpuAirCPerLoad: p(30, "°C", 0, 100, "공랭 GPU가 부하 100%에서 더 오르는 폭"),
  gpuDlcBaseC: p(12, "°C", 0, 60, "냉각판 GPU가 냉각수 위로 오르는 기본 폭"),
  gpuDlcCPerLoad: p(22, "°C", 0, 100, "냉각판 GPU가 부하 100%에서 더 오르는 폭"),
  gpuImmersionBaseC: p(8, "°C", 0, 60, "침지 GPU가 욕조 위로 오르는 기본 폭"),
  gpuImmersionCPerLoad: p(14, "°C", 0, 100, "침지 GPU가 부하 100%에서 더 오르는 폭"),
} as const;

export const COOLING_UNIT = {
  cop: p(3, "배", 1, 8, "압축기가 뺀 열 ÷ 압축기 전력(성능계수). 곡선이 있으면 곡선이 이겨요"),
} as const;

export const COOLING_LIQUID = {
  rdhxShare: p(0.75, "비율", 0, 1, "리어도어가 랙 열 가운데 물로 가져가는 비율"),
  fluidJPerLK: p(1600, "J/(K·L)", 500, 5000, "침지 유체 1L의 열용량"),
  serverJPerK: p(6000, "J/K", 100, 100000, "탱크 안 서버 한 대의 열용량"),
  tankDeltaK: p(12, "K", 1, 40, "설계 부하에서 욕조가 냉각수보다 높은 폭"),
  tankSurfaceWPerK: p(40, "W/K", 0, 1000, "탱크 벽으로 방에 새는 열(방 온도 1도 차이당)"),
  fluidMaxC: p(95, "°C", 40, 150, "침지 유체 온도 상한(계산 안전판)"),
  tankCirculationFail: p(0.08, "비율", 0, 1, "순환 펌프가 멈췄을 때 남는 열교환 비율"),
  stagnantRiseC: p(33, "°C", 0, 100, "흐름 없는 냉각판 냉각수가 설계 열에서 방보다 오르는 폭"),
  stagnantDesignWPerKw: p(800, "W/kW", 100, 1000, "냉각판 설계 열 = 랙 최대 kW × 이 값"),
  stagnantTauS: p(300, "s", 1, 7200, "흐름 없는 냉각수 온도가 목표를 따라가는 시간 상수"),
} as const;

export const COOLING_PLANT = {
  waterJPerLK: p(4186, "J/(K·L)", 3000, 5000, "물 1L의 열용량"),
  maxLoopC: p(60, "°C", 20, 120, "냉각수 루프 온도 상한(계산 안전판)"),
  availBandC: p(8, "°C", 1, 40, "급수가 설정보다 이만큼 더워지면 소비자가 받는 물이 0이 돼요"),
  availOffsetC: p(1, "°C", 0, 10, "급수가 설정보다 이만큼은 더워져도 괜찮은 여유"),
  cduIdleSupplyC: p(45, "°C", 10, 80, "멈춘 CDU 급수가 향하는 온도"),
  cduIdleTauS: p(900, "s", 1, 36000, "멈춘 CDU 급수가 그 온도로 가는 시간 상수"),
  cduTauS: p(45, "s", 1, 3600, "CDU 급수가 설정 온도를 따라가는 시간 상수"),
  cduSpreadC: p(10, "°C", 0, 40, "CDU가 능력만큼 일할 때 공급과 환수의 온도 차"),
  chillerTauS: p(60, "s", 1, 3600, "칠러 급수가 설정 온도를 따라가는 시간 상수"),
  chillerSpreadC: p(6, "°C", 0, 40, "칠러가 능력만큼 일할 때 공급과 환수의 온도 차"),
  chillerAuxShare: p(0.01, "비율", 0, 0.2, "칠러가 일이 없어도 쓰는 전력(능력 대비)"),
  dryCoolerBase: p(1.1, "비율", 0.5, 2, "드라이쿨러 능력 비율의 기준값(바깥 기준 온도에서)"),
  dryCoolerSlopePerC: p(0.01, "1/°C", 0, 0.1, "바깥이 1도 오를 때 드라이쿨러 능력이 줄어드는 양"),
  dryCoolerRefC: p(15, "°C", -20, 50, "드라이쿨러 기준 바깥 온도"),
  dryCoolerMin: p(0.3, "비율", 0, 1, "드라이쿨러 능력 비율의 하한"),
  towerBase: p(1.04, "비율", 0.5, 2, "냉각탑 능력 비율의 기준값"),
  towerSlopePerC: p(0.004, "1/°C", 0, 0.1, "바깥이 1도 오를 때 냉각탑 능력이 줄어드는 양"),
  towerRefC: p(15, "°C", -20, 50, "냉각탑 기준 바깥 온도"),
  towerMin: p(0.5, "비율", 0, 1, "냉각탑 능력 비율의 하한"),
  chillerLossShare: p(0.15, "비율", 0, 1, "칠러 능력이 바깥 온도 구간 끝에서 줄어드는 비율"),
  chillerSpanC: p(15, "°C", 1, 60, "칠러 능력이 줄어드는 바깥 온도 구간 폭"),
  chillerRefC: p(25, "°C", -20, 60, "칠러 능력이 줄기 시작하는 바깥 온도"),
  chillerMin: p(0.85, "비율", 0, 1, "칠러 능력 비율의 하한"),
} as const;

const derate = (ko: string, sample: ReadonlyArray<readonly [number, number]>): CurveSpec => ({
  xUnit: "°C",
  yUnit: "비율",
  xMin: -50,
  xMax: 70,
  yMin: 0,
  yMax: 1,
  ko,
  sample,
});

export const COOLING_PLANT_CURVES = {
  derateChiller: derate("바깥 온도에 따른 칠러 능력 비율", [
    [25, 1],
    [40, 0.85],
  ]),
  derateDryCooler: derate("바깥 온도에 따른 드라이쿨러 능력 비율", [
    [25, 1],
    [45, 0.8],
    [65, 0.6],
  ]),
  derateCoolingTower: derate("바깥 온도에 따른 냉각탑 능력 비율", [
    [24, 1],
    [45, 0.92],
  ]),
} as const;

export const COOLING_UNIT_CURVES = {
  copCurve: {
    xUnit: "°C",
    yUnit: "배",
    xMin: -50,
    xMax: 70,
    yMin: 1,
    yMax: 12,
    ko: "바깥 온도에 따른 냉방기 성능계수(COP)",
    sample: [
      [-10, 3],
      [45, 3],
    ],
  } satisfies CurveSpec,
} as const;
