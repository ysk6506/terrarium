/**
 * Built-in scenarios (REQ-033): ready-made incidents that fit any world with the right equipment.
 * Each template picks its targets from the world it is given, so "냉방기 정지" works in a small lab
 * and in a whole site. The prompt never names the answer.
 */
import { withJosa } from "@terrarium/core/kernel";
import type { BlueprintIndex, Entity } from "@terrarium/core/world";
import { FACILITY_TEMPLATES } from "./library-facility";
import { FIRMWARE_TEMPLATES } from "./library-firmware";
import {
  agent,
  allOf,
  busiestServer,
  byLinks,
  doc,
  Flow,
  needs,
  powered,
  type ScenarioTemplate,
  SUBMIT,
} from "./library-kit";
import { NETWORK_TEMPLATES } from "./library-network";
import type { Condition, Expectation } from "./model";

export { allOf, type ScenarioTemplate };

/** A server is alive when it is on and heat did not shut it down; `powered` stays true for a server someone switched off. */
const aliveServer = (id: string): Condition => ({
  kind: "state",
  entity: id,
  field: "adminOn",
  op: "==",
  value: true,
});

const coolingFailure: ScenarioTemplate = {
  id: "cooling-failure",
  name: "냉방기 정지",
  summary: "가장 많은 랙을 맡은 냉방기가 멈춰 서버룸 온도가 올라요.",
  difficulty: "보통",
  faultTypes: ["cooling_unit_failure"],
  unavailable: (index) => needs(index, ["cooling_unit", "server"]),
  build(index, worldId) {
    const unit = byLinks(
      index,
      "cooling_unit",
      (u) => index.incoming(u.id, "cooling").length,
    ) as Entity;
    // Cooling units stand in a room or a containment, so a room always encloses them.
    const room = index.enclosing(unit.id, "room") as Entity;
    const racks = index.incoming(unit.id, "cooling").map((l) => l.from);
    const servers = racks.flatMap((r) =>
      index
        .descendants(r)
        .filter((e) => e.kind === "server")
        .map((e) => e.id),
    );
    // The other unit in the room can carry more if its setpoint comes down; in the sample campus the room
    // barely warms either way (two units of 100 kW for a few kW of load), so this is a small share of the sheet.
    const spare = index
      .descendants(room.id)
      .filter((e) => e.kind === "cooling_unit" && e.id !== unit.id)
      .sort((a, b) => a.id.localeCompare(b.id))[0];
    const flow = new Flow();
    const start = flow.add("start", "start", {});
    const fault = flow.add(
      "fault",
      "inject_fault",
      { faultType: "cooling_unit_failure", target: unit.id, durationSeconds: 0 },
      start,
    );
    const wait = flow.add("wait", "wait", { seconds: 300 }, fault);
    flow.add(
      "agent",
      "agent_task",
      agent(`${room.name}에서 온도 관련 알람이 이어지고 있다는 신고가 들어왔다. ${SUBMIT}`),
      wait,
    );
    return doc(
      this,
      worldId,
      `${withJosa(unit.name, "이")} 멈춰요. 영향 랙 ${racks.length}개.`,
      flow,
      [
        {
          id: "diagnosis",
          kind: "diagnosis",
          rootCause: [unit.id],
          faultType: ["cooling_unit_failure"],
          weight: 60,
        },
        ...(servers.length > 0
          ? [
              {
                id: "servers-alive",
                kind: "final_state" as const,
                label: "냉방 영향권 서버가 모두 켜져 있고, 열 보호로 꺼진 적이 없어요",
                condition: allOf([
                  ...servers.map(aliveServer),
                  { kind: "event", type: "thermal.shutdown", occurred: false },
                ]),
                weight: 20,
              },
            ]
          : []),
        ...(spare && servers.length > 0
          ? [
              {
                id: "spare-setpoint",
                kind: "required_action" as const,
                label: `${spare.name} 설정 온도 낮추기`,
                action: "setpoint_change" as const,
                target: spare.id,
                weight: 10,
              },
            ]
          : []),
        { id: "time", kind: "time_limit", seconds: 1800, weight: 10 },
        { id: "budget", kind: "tool_budget", maxCalls: 30, weight: 10 },
      ],
    );
  },
};

/** A PDU that powers a switch makes the most interesting cascade; any PDU will do otherwise. */
const cascadePdu = (index: BlueprintIndex) =>
  byLinks(
    index,
    "pdu",
    (p) =>
      index.incoming(p.id, "power").filter((l) => index.entity(l.from).kind === "switch").length,
  );

const breakerCascade: ScenarioTemplate = {
  id: "pdu-breaker-cascade",
  name: "PDU 차단기 트립 연쇄",
  summary: "ToR 스위치를 먹이는 PDU가 트립해 다른 랙 서버까지 네트워크가 끊겨요.",
  difficulty: "어려움",
  faultTypes: ["breaker_trip"],
  unavailable: (index) => needs(index, ["pdu", "server"]),
  build(index, worldId) {
    const pdu = cascadePdu(index) as Entity;
    const switches = index
      .incoming(pdu.id, "power")
      .map((l) => index.entity(l.from))
      .filter((e) => e.kind === "switch");
    const flow = new Flow();
    const start = flow.add("start", "start", {});
    const fault = flow.add(
      "fault",
      "inject_fault",
      { faultType: "breaker_trip", target: pdu.id, durationSeconds: 0 },
      start,
    );
    const wait = flow.add("wait", "wait", { seconds: 60 }, fault);
    flow.add(
      "agent",
      "agent_task",
      agent(`여러 서버에서 전원 상실과 네트워크 단절 알람이 한꺼번에 올라왔다. ${SUBMIT}`),
      wait,
    );
    return doc(this, worldId, `${pdu.name} 차단기가 트립해요.`, flow, [
      {
        id: "diagnosis",
        kind: "diagnosis",
        rootCause: [pdu.id],
        faultType: ["breaker_trip"],
        weight: 50,
      },
      {
        id: "reset",
        kind: "required_action",
        label: "차단기 리셋",
        action: "breaker_reset",
        target: pdu.id,
        weight: 20,
      },
      ...switches.map((sw) => ({
        id: `restored-${sw.id}`,
        kind: "final_state" as const,
        label: `${sw.name} 전원 복구`,
        condition: powered(sw.id),
        weight: 20 / switches.length,
      })),
      {
        id: "no-server-power",
        kind: "forbidden_action",
        label: "원인과 무관한 장비 전원 끄기",
        action: "power_off",
        penalty: 10,
      },
      { id: "budget", kind: "tool_budget", maxCalls: 30, weight: switches.length > 0 ? 10 : 30 },
    ]);
  },
};

const sensorDrift: ScenarioTemplate = {
  id: "sensor-drift",
  name: "센서 오차로 인한 허위 알람",
  summary: "흡기 센서가 실제보다 높게 읽혀 알람이 울리지만 실제 온도는 정상이에요.",
  difficulty: "보통",
  faultTypes: ["sensor_drift"],
  unavailable: (index) => needs(index, ["server"]),
  build(index, worldId) {
    const server = busiestServer(index) as Entity;
    // Well past the inlet warning threshold, so monitoring raises the (false) alarm.
    const deltaC = 12;
    const flow = new Flow();
    const start = flow.add("start", "start", {});
    const fault = flow.add(
      "fault",
      "inject_fault",
      { faultType: "sensor_drift", target: server.id, faultParams: { deltaC }, durationSeconds: 0 },
      start,
    );
    const wait = flow.add("wait", "wait", { seconds: 120 }, fault);
    flow.add(
      "agent",
      "agent_task",
      agent(
        `${server.name}의 흡기 온도 알람이 계속 울린다. 실제 상황을 확인하고, ${SUBMIT}`,
        30,
        1800,
      ),
      wait,
    );
    return doc(this, worldId, `${server.name}의 흡기 센서가 +${deltaC}°C 틀려요.`, flow, [
      {
        id: "diagnosis",
        kind: "diagnosis",
        rootCause: [server.id],
        faultType: ["sensor_drift"],
        weight: 60,
      },
      {
        id: "no-setpoint",
        kind: "forbidden_action",
        label: "불필요한 냉방 설정 변경",
        action: "setpoint_change",
        penalty: 15,
      },
      {
        id: "no-poweroff",
        kind: "forbidden_action",
        label: "멀쩡한 서버 전원 끄기",
        action: "power_off",
        target: server.id,
        penalty: 15,
      },
      { id: "time", kind: "time_limit", seconds: 1200, weight: 25 },
      { id: "budget", kind: "tool_budget", maxCalls: 25, weight: 15 },
    ]);
  },
};

const fanFailure: ScenarioTemplate = {
  id: "fan-failure-throttle",
  name: "팬 고장과 CPU 스로틀링",
  summary: "부하가 높은 서버의 팬 두 개가 멈춰 CPU가 뜨거워져요.",
  difficulty: "쉬움",
  faultTypes: ["fan_failure"],
  unavailable: (index) => needs(index, ["server"]),
  build(index, worldId) {
    const server = busiestServer(index) as Entity;
    const flow = new Flow();
    const start = flow.add("start", "start", {});
    const load = flow.add("load", "set_load", { target: server.id, value: 0.95 }, start);
    const fan1 = flow.add(
      "fan1",
      "inject_fault",
      {
        faultType: "fan_failure",
        target: server.id,
        faultParams: { fanIndex: 0 },
        durationSeconds: 0,
      },
      load,
    );
    const fan2 = flow.add(
      "fan2",
      "inject_fault",
      {
        faultType: "fan_failure",
        target: server.id,
        faultParams: { fanIndex: 1 },
        durationSeconds: 0,
      },
      fan1,
    );
    const wait = flow.add("wait", "wait", { seconds: 300 }, fan2);
    flow.add(
      "agent",
      "agent_task",
      agent(`${server.name}에서 성능 저하와 하드웨어 경고가 보고됐다. ${SUBMIT}`, 25, 1800),
      wait,
    );
    return doc(this, worldId, `${server.name}의 팬 0·1번이 멈춰요.`, flow, [
      {
        id: "diagnosis",
        kind: "diagnosis",
        rootCause: [server.id],
        faultType: ["fan_failure"],
        weight: 70,
      },
      {
        id: "no-poweroff",
        kind: "forbidden_action",
        label: "서버 전원 끄기 (올라간 VM이 같이 죽어요)",
        action: "power_off",
        target: server.id,
        penalty: 15,
      },
      { id: "time", kind: "time_limit", seconds: 900, weight: 15 },
      { id: "budget", kind: "tool_budget", maxCalls: 20, weight: 15 },
    ]);
  },
};

/** Diagnosis, then the VM calmed and stopped (physics rewards it), and the hosts left alone. */
function noisyExpectations(vm: Entity, host: string, stopped: Condition): Expectation[] {
  return [
    {
      id: "diagnosis",
      kind: "diagnosis",
      rootCause: [vm.id],
      faultType: ["vm_cpu_spike"],
      weight: 45,
    },
    {
      id: "vm-calm",
      kind: "final_state",
      label: "폭주한 VM이 멈췄거나 CPU 알람이 풀렸어요",
      condition: {
        kind: "any",
        of: [stopped, { kind: "alarm", active: false, entity: vm.id, code: "vm_cpu_high" }],
      },
      weight: 25,
    },
    {
      id: "stop-vm",
      kind: "required_action",
      label: `${vm.name} 전원 끄기`,
      action: "power_off",
      target: vm.id,
      weight: 10,
    },
    {
      id: "no-host-poweroff",
      kind: "forbidden_action",
      label: "호스트 전원 차단 (다른 VM까지 멈춰요)",
      action: "power_off",
      target: host,
      penalty: 20,
    },
    {
      id: "no-host-restart",
      kind: "forbidden_action",
      label: "호스트 재시작 (다른 VM까지 멈춰요)",
      action: "restart",
      target: host,
      penalty: 10,
    },
    { id: "time", kind: "time_limit", seconds: 900, weight: 10 },
    { id: "budget", kind: "tool_budget", maxCalls: 30, weight: 10 },
  ];
}

const noisyNeighbour: ScenarioTemplate = {
  id: "vm-cpu-spike-escalation",
  name: "VM CPU 폭주와 확산",
  summary: "한 VM이 CPU를 독차지해요. 15분 안에 진단하지 못하면 호스트 CPU까지 폭주해요.",
  difficulty: "어려움",
  faultTypes: ["vm_cpu_spike", "cpu_runaway"],
  unavailable: (index) =>
    index.ofKind("vm").some((vm) => index.outgoing(vm.id, "runs_on").length > 0)
      ? undefined
      : "호스트에 올라간 VM이 없어요",
  build(index, worldId) {
    const vm = index.ofKind("vm").find((v) => index.outgoing(v.id, "runs_on").length > 0) as Entity;
    const host = index.outgoing(vm.id, "runs_on")[0]?.to as string;
    const cluster = index.outgoing(host, "member_of")[0]?.to;
    const where = cluster ? `${index.entity(cluster).name} 클러스터` : "가상화 환경";
    const flow = new Flow();
    const start = flow.add("start", "start", {});
    const spike = flow.add(
      "spike",
      "inject_fault",
      { faultType: "vm_cpu_spike", target: vm.id, durationSeconds: 0 },
      start,
    );
    const wait = flow.add("wait", "wait", { seconds: 180 }, spike);
    const task = flow.add(
      "agent",
      "agent_task",
      agent(`${where}의 서비스 응답이 느리다는 민원이 들어왔다. ${SUBMIT}`),
      wait,
    );
    // The spread to the host is for an agent that neither stops the VM nor answers; either one ends the wait.
    const stopped: Condition = {
      kind: "state",
      entity: vm.id,
      field: "running",
      op: "==",
      value: false,
    };
    const deadline = flow.add(
      "deadline",
      "wait_until",
      {
        condition: { kind: "any", of: [stopped, { kind: "diagnosis_submitted" }] },
        timeoutSeconds: 900,
      },
      task,
    );
    flow.add(
      "escalate",
      "inject_fault",
      { faultType: "cpu_runaway", target: host, durationSeconds: 0 },
      deadline,
      "timeout",
      1,
    );
    return doc(
      this,
      worldId,
      `${vm.name}의 CPU 수요가 치솟고, 늦으면 ${index.entity(host).name}까지 번져요.`,
      flow,
      noisyExpectations(vm, host, stopped),
    );
  },
};

export const SCENARIO_TEMPLATES: readonly ScenarioTemplate[] = [
  fanFailure,
  coolingFailure,
  sensorDrift,
  breakerCascade,
  noisyNeighbour,
];

/** Incidents that need a plant, liquid cooling or a generator: only worlds that have them can use these. */
export { FACILITY_TEMPLATES };

/** Changes people make to the network and to PDUs (REQ-068): a wrong VLAN, a shut port, a deleted route. */
export { NETWORK_TEMPLATES };

/** Work an operator does in a maintenance window (REQ-071): raising the firmware of servers. */
export { FIRMWARE_TEMPLATES };

/** Every built-in template, the facility ones and then the configuration ones last. */
export const ALL_SCENARIO_TEMPLATES: readonly ScenarioTemplate[] = [
  ...SCENARIO_TEMPLATES,
  ...FACILITY_TEMPLATES,
  ...NETWORK_TEMPLATES,
  ...FIRMWARE_TEMPLATES,
];

/** How the new-scenario picker groups the templates: equipment first, then changes people make to settings. */
export const TEMPLATE_GROUPS: readonly {
  readonly id: "facility" | "network" | "firmware";
  readonly label: string;
  readonly templates: readonly ScenarioTemplate[];
}[] = [
  { id: "facility", label: "설비", templates: [...SCENARIO_TEMPLATES, ...FACILITY_TEMPLATES] },
  { id: "network", label: "네트워크·전원 설정", templates: NETWORK_TEMPLATES },
  { id: "firmware", label: "펌웨어 작업", templates: FIRMWARE_TEMPLATES },
];

export function scenarioTemplate(id: string): ScenarioTemplate | undefined {
  return ALL_SCENARIO_TEMPLATES.find((t) => t.id === id);
}
