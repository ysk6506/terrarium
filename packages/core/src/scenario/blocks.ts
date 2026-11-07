/**
 * The blocks of the no-code scenario editor (REQ-034). The editor builds its palette from this table,
 * the validator checks documents against it and the runner executes it. A block the simulator cannot
 * honour yet is listed with `status: "planned"` and the reason, so people see it but cannot use it.
 */
import type { EntityKind } from "@terrarium/core/world";
import { LAYER_CONDITION_FIELDS } from "./blocks-app";
import { NET_BLOCK_SPECS } from "./blocks-net";
import { SDN_CONDITION_FIELDS } from "./blocks-sdn";
import { SERVICE_FIELDS } from "./blocks-service";
import { bool, type FieldSpec, HEALTH, num, version } from "./field-spec";

export type { FieldSpec };

import type { ScenarioNode } from "./model";

export type BlockCategory = "flow" | "fault" | "operation" | "agent";

export const CATEGORY_LABELS: Readonly<Record<BlockCategory, string>> = {
  fault: "고장",
  operation: "설정 바꾸기",
  flow: "흐름",
  agent: "에이전트",
};

interface ParamBase {
  readonly name: string;
  readonly label: string;
  readonly optional?: boolean;
  readonly help?: string;
}

/** What a parameter that depends on the chosen switch or PDU offers to pick from, read off the network the cables design. */
export type NetPick = "cabled_peer" | "svi_vlan" | "bgp_peer" | "static_route" | "outlet";

export type ParamSpec = ParamBase &
  (
    | {
        readonly kind: "number";
        readonly min: number;
        readonly max: number;
        readonly unit: string;
        readonly default: number;
        readonly integer?: boolean;
        /** Stored as 0 for "until it is fixed"; the form offers that as a choice beside "after n minutes". */
        readonly recovery?: boolean;
      }
    | { readonly kind: "entity"; readonly kinds: readonly EntityKind[] }
    | { readonly kind: "fault_type" }
    /** An entity or link the chosen `faultType` can target. */
    | { readonly kind: "fault_target" }
    /** Numeric parameters of the chosen `faultType` (see FAULT_SPECS). */
    | { readonly kind: "fault_params" }
    | {
        readonly kind: "text";
        readonly maxLength: number;
        readonly multiline?: boolean;
        readonly default?: string;
      }
    | { readonly kind: "boolean"; readonly default: boolean }
    | { readonly kind: "condition" }
    /** One of the things `dependsOn` (another parameter, a switch or PDU) has: a cabled device, a VLAN interface, a route... */
    | { readonly kind: "net_pick"; readonly pick: NetPick; readonly dependsOn: string }
    /** The id of another block of `nodeType`. */
    | { readonly kind: "node_ref"; readonly nodeType: string }
  );

export interface BlockSpec {
  readonly type: string;
  readonly category: BlockCategory;
  readonly label: string;
  readonly description: string;
  /** Whether other blocks can lead into this one. */
  readonly hasInput: boolean;
  /** Output ports; `random` derives them from its `branches` parameter instead. */
  readonly outputs: readonly string[];
  readonly params: readonly ParamSpec[];
  readonly status: "supported" | "planned";
  /** Why a planned block cannot be used yet. */
  readonly plannedReason?: string;
  /** How many of this block a scenario must / may have. */
  readonly minCount?: number;
  readonly maxCount?: number;
  /** The world must contain at least one entity of one of these kinds. */
  readonly needsAnyOf?: readonly EntityKind[];
}

export const PORT_LABELS: Readonly<Record<string, string>> = {
  next: "다음",
  yes: "예",
  no: "아니오",
  met: "충족",
  timeout: "시간 초과",
};

/** A duration stored in seconds. People read and type it in minutes (see `toMinutes`). */
const seconds = (
  name: string,
  label: string,
  min: number,
  max: number,
  def: number,
  extra: { readonly recovery?: boolean } = {},
): ParamSpec => ({
  name,
  label,
  kind: "number",
  min,
  max,
  unit: "초",
  default: def,
  integer: true,
  ...extra,
});

const CORE_BLOCK_SPECS: readonly BlockSpec[] = [
  {
    type: "start",
    category: "flow",
    label: "시작",
    description: "시나리오가 여기서 시작해요. 세계는 정상 운영 상태에서 출발해요.",
    hasInput: false,
    outputs: ["next"],
    params: [],
    status: "supported",
    minCount: 1,
    maxCount: 1,
  },
  {
    type: "wait",
    category: "flow",
    label: "대기",
    description: "시뮬레이션 시간이 정해진 만큼 흐른 뒤 다음으로 가요.",
    hasInput: true,
    outputs: ["next"],
    params: [seconds("seconds", "대기 시간", 1, 86_400, 300)],
    status: "supported",
  },
  {
    type: "wait_until",
    category: "flow",
    label: "조건 대기",
    description: "조건이 맞으면 '충족'으로, 제한 시간이 지나면 '시간 초과'로 가요.",
    hasInput: true,
    outputs: ["met", "timeout"],
    params: [
      { name: "condition", label: "조건", kind: "condition" },
      seconds("timeoutSeconds", "제한 시간", 1, 86_400, 1800),
    ],
    status: "supported",
  },
  {
    type: "branch",
    category: "flow",
    label: "분기",
    description: "지금 조건이 맞으면 '예', 아니면 '아니오'로 가요.",
    hasInput: true,
    outputs: ["yes", "no"],
    params: [{ name: "condition", label: "조건", kind: "condition" }],
    status: "supported",
  },
  {
    type: "random",
    category: "flow",
    label: "무작위 선택",
    description:
      "갈래 중 하나를 골라요. 실험의 시드가 같으면 늘 같은 갈래를 고르므로 결과를 재현할 수 있어요.",
    hasInput: true,
    outputs: [],
    params: [
      {
        name: "branches",
        label: "갈래 수",
        kind: "number",
        min: 2,
        max: 4,
        unit: "개",
        default: 2,
        integer: true,
      },
    ],
    status: "supported",
  },
  {
    type: "note",
    category: "flow",
    label: "메모",
    description: "설명을 남겨요. 실행에는 영향이 없어요.",
    hasInput: true,
    outputs: ["next"],
    params: [
      {
        name: "text",
        label: "내용",
        kind: "text",
        maxLength: 500,
        multiline: true,
        optional: true,
      },
    ],
    status: "supported",
  },
  {
    type: "inject_fault",
    category: "fault",
    label: "고장 발생",
    description:
      "대상에 고장을 일으켜요. '고쳐질 때까지'를 고르면 고장 복구 블록이나 에이전트의 조치가 있을 때까지 계속돼요.",
    hasInput: true,
    outputs: ["next"],
    params: [
      { name: "faultType", label: "고장 종류", kind: "fault_type" },
      { name: "target", label: "대상", kind: "fault_target" },
      { name: "faultParams", label: "세부 설정", kind: "fault_params", optional: true },
      seconds("durationSeconds", "복구 방식", 0, 86_400, 0, { recovery: true }),
    ],
    status: "supported",
  },
  {
    type: "clear_fault",
    category: "fault",
    label: "고장 복구",
    description: "앞에서 일으킨 고장을 없애요 (자연 복구, 현장 기사 조치 등).",
    hasInput: true,
    outputs: ["next"],
    params: [
      { name: "ref", label: "복구할 고장 발생 블록", kind: "node_ref", nodeType: "inject_fault" },
    ],
    status: "supported",
  },
  {
    type: "set_load",
    category: "operation",
    label: "부하 변경",
    description: "서버나 VM의 CPU 부하를 바꿔요 (배치 작업 시작, 트래픽 급증 등).",
    hasInput: true,
    outputs: ["next"],
    params: [
      { name: "target", label: "대상", kind: "entity", kinds: ["server", "vm"] },
      { name: "value", label: "부하", kind: "number", min: 0, max: 1, unit: "비율", default: 0.7 },
    ],
    status: "supported",
    needsAnyOf: ["server", "vm"],
  },
  {
    type: "set_setpoint",
    category: "operation",
    label: "냉방 설정 온도",
    description: "냉방기의 급기 설정 온도를 바꿔요 (운영자의 설정 변경).",
    hasInput: true,
    outputs: ["next"],
    params: [
      { name: "target", label: "냉방기", kind: "entity", kinds: ["cooling_unit"] },
      {
        name: "celsius",
        label: "설정 온도",
        kind: "number",
        min: 10,
        max: 35,
        unit: "°C",
        default: 18,
        help: "실제 허용 범위는 냉방기 모델에 따라 달라요.",
      },
    ],
    status: "supported",
    needsAnyOf: ["cooling_unit"],
  },
  {
    type: "power",
    category: "operation",
    label: "전원 켜기/끄기",
    description: "장비나 VM의 전원을 켜거나 꺼요 (작업자의 계획 정지 등).",
    hasInput: true,
    outputs: ["next"],
    params: [
      {
        name: "target",
        label: "대상",
        kind: "entity",
        kinds: ["server", "switch", "storage", "cooling_unit", "vm"],
      },
      { name: "on", label: "켜기", kind: "boolean", default: false },
    ],
    status: "supported",
    needsAnyOf: ["server", "switch", "storage", "cooling_unit", "vm"],
  },
  {
    type: "set_outdoor_temp",
    category: "operation",
    label: "외기 온도 변경",
    description:
      "폭염·한파처럼 바깥 온도가 바뀌어요. 칠러·드라이쿨러·냉각탑의 냉각 용량이 따라 줄고 늘어요.",
    hasInput: true,
    outputs: ["next"],
    params: [
      {
        name: "celsius",
        label: "외기 온도",
        kind: "number",
        min: -20,
        max: 45,
        unit: "°C",
        default: 35,
      },
    ],
    status: "supported",
    needsAnyOf: ["site", "room"],
  },
  {
    type: "network_degrade",
    category: "operation",
    label: "네트워크 품질 저하",
    description: "링크에 지연이나 패킷 손실을 줘요.",
    hasInput: true,
    outputs: ["next"],
    params: [
      { name: "target", label: "스위치", kind: "entity", kinds: ["switch"] },
      {
        name: "latencyMs",
        label: "추가 지연",
        kind: "number",
        min: 1,
        max: 5000,
        unit: "ms",
        default: 200,
      },
    ],
    status: "planned",
    plannedReason:
      "링크 지연·손실 모델과 경로의 링크 id가 아직 없어요. 네트워크 링크는 연결/끊김만 시뮬레이션하고, 경로의 홉은 링크를 가리키지 않아요.",
  },
  {
    type: "agent_task",
    category: "agent",
    label: "에이전트 투입",
    description:
      "여기서 에이전트에게 과제를 줘요. 이후 블록은 에이전트가 일하는 동안에도 계속 진행돼요 (고장 확산 등).",
    hasInput: true,
    outputs: ["next"],
    params: [
      {
        name: "prompt",
        label: "상황 설명",
        kind: "text",
        maxLength: 4000,
        multiline: true,
        help: "에이전트가 받는 상황 설명이에요. 정답은 적지 않아요.",
      },
      {
        name: "maxToolCalls",
        label: "툴 호출 상한",
        kind: "number",
        min: 1,
        max: 500,
        unit: "회",
        default: 40,
        integer: true,
      },
      seconds("timeLimitSeconds", "제한 시간", 60, 345_600, 3600),
    ],
    status: "supported",
    minCount: 1,
    maxCount: 1,
  },
];

/** Every block, the configuration blocks (REQ-068) before the agent's. */
export const BLOCK_SPECS: readonly BlockSpec[] = [
  ...CORE_BLOCK_SPECS.filter((b) => b.type !== "agent_task"),
  ...NET_BLOCK_SPECS,
  ...CORE_BLOCK_SPECS.filter((b) => b.type === "agent_task"),
];

export function blockSpec(type: string): BlockSpec | undefined {
  return BLOCK_SPECS.find((b) => b.type === type);
}

/** Output ports of a node: fixed per block, or "1".."n" for random. */
export function outputsOf(node: Pick<ScenarioNode, "type" | "params">): string[] {
  if (node.type === "random") {
    const n = typeof node.params.branches === "number" ? Math.trunc(node.params.branches) : 2;
    return Array.from({ length: Math.min(Math.max(n, 2), 4) }, (_, i) => String(i + 1));
  }
  return [...(blockSpec(node.type)?.outputs ?? [])];
}

/** Condition fields per entity kind. A test checks every one exists in the world state. */
export const CONDITION_FIELDS: Readonly<Record<EntityKind, Readonly<Record<string, FieldSpec>>>> = {
  site: { health: HEALTH, outdoorC: num("외기 온도", "°C") },
  parcel: { health: HEALTH },
  building: { health: HEALTH },
  floor: { health: HEALTH },
  room: { health: HEALTH, ambientC: num("실내 온도", "°C") },
  containment: {
    health: HEALTH,
    coldC: num("냉복도 온도", "°C"),
    hotC: num("열복도 온도", "°C"),
  },
  rack: {
    health: HEALTH,
    inletC: num("흡기 온도", "°C"),
    outletC: num("배기 온도", "°C"),
    powerW: num("소비 전력", "W"),
    liquidW: num("수랭 열량", "W"),
    coolantC: num("냉각수 온도", "°C"),
    bathC: num("액침 유체 온도", "°C"),
    rebootPeak: num("펌웨어 때문에 한꺼번에 재부팅한 서버 수(가장 많았을 때)", "대"),
  },
  cdu: {
    health: HEALTH,
    running: bool("가동 중"),
    powered: bool("전원 공급"),
    supplyC: num("공급 냉각수 온도", "°C"),
    returnC: num("회수 냉각수 온도", "°C"),
    loadKw: num("부하", "kW"),
  },
  chiller: {
    health: HEALTH,
    running: bool("가동 중"),
    powered: bool("전원 공급"),
    supplyC: num("공급 수온", "°C"),
    returnC: num("회수 수온", "°C"),
    loadKw: num("부하", "kW"),
  },
  generator: {
    health: HEALTH,
    phase: {
      label: "가동 단계",
      type: "enum",
      values: ["standby", "starting", "running", "failed"],
    },
    fuelPct: num("연료 잔량", "%"),
    loadKw: num("부하", "kW"),
  },
  server: {
    health: HEALTH,
    powered: bool("전원 공급"),
    adminOn: bool("전원 켜짐"),
    throttled: bool("스로틀링"),
    inletC: num("흡기 온도", "°C"),
    cpuC: num("CPU 온도", "°C"),
    cpuUtil: num("CPU 사용률", "비율"),
    powerW: num("소비 전력", "W"),
    bmcVersion: version("BMC 펌웨어 버전"),
    biosVersion: version("BIOS 펌웨어 버전"),
    rebooting: bool("펌웨어 때문에 재부팅 중"),
  },
  switch: { health: HEALTH, powered: bool("전원 공급"), adminOn: bool("전원 켜짐") },
  storage: {
    health: HEALTH,
    powered: bool("전원 공급"),
    failedDisks: num("고장 디스크", "개"),
    usedPct: num("사용량", "%"),
  },
  pdu: {
    health: HEALTH,
    powered: bool("전원 공급"),
    tripped: bool("차단기 트립"),
    loadW: num("부하", "W"),
  },
  power_panel: {
    health: HEALTH,
    powered: bool("전원 공급"),
    tripped: bool("차단기 트립"),
    loadW: num("부하", "W"),
    loadA: num("전류", "A"),
  },
  ups: {
    health: HEALTH,
    inputOk: bool("입력 전원 정상"),
    onBattery: bool("배터리 운전"),
    batteryPct: num("배터리 잔량", "%"),
    loadW: num("부하", "W"),
  },
  cooling_unit: {
    health: HEALTH,
    running: bool("가동 중"),
    powered: bool("전원 공급"),
    setpointC: num("설정 온도", "°C"),
    supplyC: num("급기 온도", "°C"),
    returnC: num("환기 온도", "°C"),
    loadKw: num("냉방 부하", "kW"),
  },
  vcenter: { health: HEALTH },
  cluster: { health: HEALTH },
  vm: {
    health: HEALTH,
    running: bool("실행 중"),
    cpuDemand: num("CPU 수요", "비율"),
    cpuUsage: num("CPU 사용률", "비율"),
    memUtil: num("메모리 사용률", "비율"),
  },
  datastore: { health: HEALTH },
  service: SERVICE_FIELDS,
  ...LAYER_CONDITION_FIELDS,
};
