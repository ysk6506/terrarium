/** The fields a condition can test on the accelerator, power and cooling entities (REQ-107). */
import { bool, type FieldSpec, HEALTH, num } from "./field-spec";

const STATUS3: FieldSpec = { label: "상태", type: "enum", values: ["ok", "degraded", "down"] };
const STATUS2: FieldSpec = { label: "상태", type: "enum", values: ["ok", "down"] };
const LINK: FieldSpec = { label: "상태", type: "enum", values: ["up", "down"] };
const PHASE: FieldSpec = {
  label: "단계",
  type: "enum",
  values: ["running", "paused", "failed", "resumed"],
};

export const ACCEL_CONDITION_FIELDS: Readonly<
  Record<
    | "gpu"
    | "nvlink_domain"
    | "ib_fabric"
    | "ib_link"
    | "job_scheduler"
    | "training_job"
    | "inference_pool"
    | "bbu"
    | "dc_bus"
    | "substation"
    | "rdhx"
    | "immersion_tank",
    Readonly<Record<string, FieldSpec>>
  >
> = {
  gpu: {
    health: HEALTH,
    status: STATUS3,
    tempC: num("GPU 온도", "°C"),
    powerW: num("GPU 전력", "W"),
    utilPct: num("GPU 사용률", "%"),
    xidErrors: num("Xid 오류 수", "건"),
    throttled: bool("클럭이 낮아짐"),
    clockPct: num("클럭", "%"),
  },
  nvlink_domain: { health: HEALTH, status: STATUS3 },
  ib_fabric: { health: HEALTH, status: STATUS3 },
  ib_link: { health: HEALTH, status: LINK, flaps: num("끊겼다 붙은 횟수", "번") },
  job_scheduler: {
    health: HEALTH,
    status: STATUS2,
    queued: num("대기 중인 잡", "개"),
    running: num("도는 잡", "개"),
  },
  training_job: {
    health: HEALTH,
    phase: PHASE,
    step: num("스텝", "스텝"),
    lostSteps: num("다시 해야 했던 스텝", "스텝"),
    restarts: num("다시 시작한 횟수", "번"),
  },
  inference_pool: {
    health: HEALTH,
    status: STATUS3,
    replicas: num("답하는 복제본", "개"),
    p99Ms: num("p99 지연", "ms"),
  },
  bbu: {
    health: HEALTH,
    status: STATUS3,
    chargePct: num("충전량", "%"),
    runtimeMin: num("버틸 수 있는 시간", "분"),
    onBattery: bool("배터리로 버팀"),
  },
  dc_bus: { health: HEALTH, status: STATUS3, voltageV: num("버스 전압", "V") },
  substation: { health: HEALTH, status: STATUS3, loadPct: num("부하율", "%") },
  rdhx: {
    health: HEALTH,
    status: STATUS3,
    waterOutC: num("나가는 물 온도", "°C"),
    valvePct: num("밸브 열림", "%"),
  },
  immersion_tank: {
    health: HEALTH,
    status: STATUS3,
    fluidC: num("유체 온도", "°C"),
    pumpOk: bool("순환 펌프 정상"),
    levelPct: num("유체 수위", "%"),
  },
};

/** What a rack with a power limit and a server with a cap can be asked (power capping, ADR-0130). */
export const RACK_CAP_FIELDS: Readonly<Record<string, FieldSpec>> = {
  overS: num("한도를 넘은 시간", "초"),
  overCount: num("한도를 넘은 횟수", "번"),
  lossS: num("캡 때문에 잃은 서버·초", "초"),
  hotAt: num("처음 뜨거워진 시각", "초"),
  stopAt: num("처음 과열로 꺼진 시각", "초"),
};
export const SERVER_CAP_FIELDS: Readonly<Record<string, FieldSpec>> = {
  powerCapW: num("전력 캡", "W"),
  perf: num("처리량", "비율"),
};
