/**
 * Firmware work (REQ-071, ADR-0101): raising the BMC and the BIOS of servers through the BMC's UpdateService, the way an
 * operator does it in a maintenance window. Three sheets: one server with no service on it, a whole rack one server at
 * a time, and a rack where one update fails. The sheets pay for the work being done and finished (the version has
 * changed and the server is back), for not taking a service down, and for never having two servers of a rack down
 * together. An agent that does nothing earns nothing, and an agent that only knows what to report earns about 40.
 */
import {
  type BlueprintIndex,
  type Entity,
  imageName,
  SHIPPED_FIRMWARE,
  updateSeconds,
} from "@terrarium/core/world";
import { agent, allOf, doc, Flow, type ScenarioTemplate } from "./library-kit";
import type { Condition, Expectation } from "./model";

/** The versions the sheets ask for. Any servers' own versions are older, since nothing ships at these. */
export const TARGET_BMC = "8.40";
export const TARGET_BIOS = "2.4.1";

const REPO = "http://repo.local/fw/";

const byId = (a: Entity, b: Entity) => a.id.localeCompare(b.id);
const unitOf = (e: Entity) => (e.placement?.type === "unit" ? e.placement.u : 0);

const is = (entity: string, field: string, value: string | number | boolean): Condition => ({
  kind: "state",
  entity,
  field,
  op: "==",
  value,
});

/** A server that runs the wanted versions and is up again. */
const upToDate = (id: string, parts: { bmc?: string; bios?: string }): Condition =>
  allOf([
    ...(parts.bmc ? [is(id, "bmcVersion", parts.bmc)] : []),
    ...(parts.bios ? [is(id, "biosVersion", parts.bios)] : []),
    is(id, "rebooting", false),
    is(id, "adminOn", true),
  ]);

const anyOf = (conditions: readonly Condition[]): Condition => ({
  kind: "any",
  of: conditions,
});

const images = `펌웨어 이미지는 ${REPO} 에 ${imageName("bmc", TARGET_BMC)}, ${imageName("bios", TARGET_BIOS)}처럼 이름 뒤에 버전이 붙어 있다.`;

/** Most conditions listed in one check (a group nests only three deep). */
const SHOWN = 15;

const REPORT =
  "끝나면 submit_diagnosis로 작업을 보고하라. rootCause에는 올린 대상, faultType에는 firmware_update를 쓴다.";

interface Rack {
  readonly rack: Entity;
  readonly servers: readonly Entity[];
  /** The servers that no virtual machine runs on. */
  readonly empty: readonly Entity[];
}

function racksWithServers(index: BlueprintIndex): Rack[] {
  return [...index.ofKind("rack")].sort(byId).flatMap((rack) => {
    const servers = index
      .childrenOf(rack.id, "server")
      .toSorted((a, b) => unitOf(a) - unitOf(b) || byId(a, b));
    const empty = servers.filter((s) => index.incoming(s.id, "runs_on").length === 0);
    return servers.length > 0 ? [{ rack, servers, empty }] : [];
  });
}

/** A rack with a server nothing runs on, preferring one that also has servers with services (that is where choosing matters). */
function oneServerRack(index: BlueprintIndex): Rack | undefined {
  const racks = racksWithServers(index).filter((r) => r.empty.length > 0);
  return racks.find((r) => r.empty.length < r.servers.length) ?? racks[0];
}

/** The rack with the most servers (the first by name among equals), if it has at least `least`. */
function biggestRack(index: BlueprintIndex, least: number): Rack | undefined {
  const racks = racksWithServers(index).filter((r) => r.servers.length >= least);
  return racks.sort((a, b) => b.servers.length - a.servers.length)[0];
}

const timeFor = (n: number, seconds: number) => 600 + n * seconds;

// --- (a) one server --------------------------------------------------------------------------

function oneServerSheet(r: Rack, index: BlueprintIndex): Expectation[] {
  const busy = r.servers.filter((s) => !r.empty.includes(s));
  const vms = busy.flatMap((s) => index.incoming(s.id, "runs_on").map((l) => l.from));
  const done = anyOf(
    r.empty.slice(0, SHOWN).map((s) => upToDate(s.id, { bmc: TARGET_BMC, bios: TARGET_BIOS })),
  );
  // The services to look after: the machines that run on the busy servers, or the servers themselves if none do.
  const kept =
    vms.length > 0
      ? vms.slice(0, SHOWN).map((vm) => is(vm, "running", true))
      : r.servers.slice(0, SHOWN).map((s) => is(s.id, "adminOn", true));
  return [
    {
      id: "report",
      kind: "diagnosis",
      label: "올린 서버와 작업 종류를 보고해요",
      rootCause: r.empty.map((s) => s.id),
      faultType: ["firmware_update"],
      weight: 20,
    },
    {
      id: "updated",
      kind: "final_state",
      label: `서비스가 없는 서버 한 대가 BMC ${TARGET_BMC}, BIOS ${TARGET_BIOS}로 올라와 켜져 있어요`,
      condition: done,
      weight: 40,
    },
    {
      id: "services",
      kind: "final_state",
      label: "올리기가 끝났을 때 서비스(가상 머신)가 모두 돌고 있어요",
      condition: allOf([done, ...kept]),
      weight: 20,
    },
    ...busy.map((s) => ({
      id: `busy-${s.id}`,
      kind: "forbidden_action" as const,
      label: `서비스가 도는 ${s.name}에 펌웨어 올리기`,
      action: "firmware_update" as const,
      target: s.id,
      penalty: 40,
    })),
    { id: "time", kind: "time_limit", seconds: 1800, weight: 10 },
    { id: "budget", kind: "tool_budget", maxCalls: 25, weight: 10 },
  ];
}

const firmwareOne: ScenarioTemplate = {
  id: "firmware-one",
  name: "서버 한 대 펌웨어 올리기",
  summary: "서비스가 없는 서버를 골라 BMC와 BIOS를 올리고, 재부팅이 끝나 돌아올 때까지 확인해요.",
  difficulty: "보통",
  faultTypes: [],
  unavailable: (index) =>
    oneServerRack(index) ? undefined : "서비스(가상 머신)가 없는 서버가 든 랙이 이 세계에 없어요",
  build(index, worldId) {
    const r = oneServerRack(index) as Rack;
    const flow = new Flow();
    const start = flow.add("start", "start", {});
    const wait = flow.add("wait", "wait", { seconds: 60 }, start);
    flow.add(
      "agent",
      "agent_task",
      agent(
        `점검 시간이다. ${r.rack.name}의 서버 중 한 대의 BMC를 ${TARGET_BMC}로, BIOS를 ${TARGET_BIOS}로 올려라. 서비스가 도는 서버는 건드리면 안 되니 어느 서버가 비어 있는지 먼저 확인하고, 올릴 서버는 직접 골라라. 올린 뒤 서버가 새 버전으로 돌아왔는지 확인한다. ${images} ${REPORT}`,
        40,
        3600,
      ),
      wait,
    );
    return doc(
      this,
      worldId,
      `${r.rack.name}의 서버 ${r.servers.length}대 중 서비스가 없는 ${r.empty.length}대만 골라 올려요.`,
      flow,
      oneServerSheet(r, index),
    );
  },
};

// --- (b) a rack, one at a time -----------------------------------------------------------------

/** Most servers a rack sheet asks for; a bigger rack is done in its first servers, from the bottom. */
const RACK_LIMIT = 6;

function rackSheet(rack: Entity, servers: readonly Entity[]): Expectation[] {
  const all = allOf(servers.map((s) => upToDate(s.id, { bios: TARGET_BIOS })));
  return [
    {
      id: "report",
      kind: "diagnosis",
      label: "올린 랙과 작업 종류를 보고해요",
      rootCause: [rack.id],
      faultType: ["firmware_update"],
      weight: 10,
    },
    {
      id: "all-updated",
      kind: "final_state",
      label: `서버 ${servers.length}대가 모두 BIOS ${TARGET_BIOS}로 올라와 켜져 있어요`,
      condition: all,
      weight: 35,
    },
    {
      id: "one-at-a-time",
      kind: "final_state",
      label: "한 랙에서 서버 둘 이상이 동시에 재부팅한 적이 없어요",
      condition: allOf([all, is(rack.id, "rebootPeak", 1)]),
      weight: 25,
    },
    { id: "time", kind: "time_limit", seconds: timeFor(servers.length, 420), weight: 15 },
    { id: "budget", kind: "tool_budget", maxCalls: 12 + servers.length * 5, weight: 15 },
  ];
}

const firmwareRack: ScenarioTemplate = {
  id: "firmware-rack",
  name: "랙 단위로 차례로 펌웨어 올리기",
  summary:
    "랙의 서버를 한 대씩 차례로 올려요. 두 대가 동시에 재부팅하면 점수를 못 받고, 끝까지 확인해야 해요.",
  difficulty: "어려움",
  faultTypes: [],
  unavailable: (index) =>
    biggestRack(index, 2) ? undefined : "서버가 2대 이상 든 랙이 이 세계에 없어요",
  build(index, worldId) {
    const r = biggestRack(index, 2) as Rack;
    const servers = r.servers.slice(0, RACK_LIMIT);
    const names = servers.map((s) => s.name).join(", ");
    const flow = new Flow();
    const start = flow.add("start", "start", {});
    const wait = flow.add("wait", "wait", { seconds: 60 }, start);
    flow.add(
      "agent",
      "agent_task",
      agent(
        `점검 시간이다. ${r.rack.name}의 서버 ${servers.length}대(${names})의 BIOS를 ${TARGET_BIOS}로 올려라. 한 랙의 서버가 한꺼번에 내려가면 안 되니 한 대가 재부팅을 마치고 돌아온 것을 확인한 다음 다음 서버를 올린다. 모두 끝나면 서버마다 버전을 다시 확인한다. ${images} ${REPORT}`,
        12 + servers.length * 5,
        timeFor(servers.length, 420) * 2,
      ),
      wait,
    );
    return doc(
      this,
      worldId,
      `${r.rack.name}의 서버 ${servers.length}대를 BIOS ${TARGET_BIOS}로 올려요. 한 대에 ${Math.round(updateSeconds("bios") / 60)}분쯤 걸려요.`,
      flow,
      rackSheet(r.rack, servers),
    );
  },
};

// --- (c) one update fails ---------------------------------------------------------------------

const FAIL_LIMIT = 4;

function failureSheet(servers: readonly Entity[], failing: Entity): Expectation[] {
  const others = servers.filter((s) => s.id !== failing.id);
  const recovered = allOf([
    { kind: "event", type: "firmware.fail", target: failing.id, occurred: true },
    { kind: "alarm", active: false, entity: failing.id, code: "firmware_update_failed" },
    is(failing.id, "rebooting", false),
    is(failing.id, "adminOn", true),
  ]);
  return [
    {
      id: "diagnosis",
      kind: "diagnosis",
      label: "실패한 서버와 고장 종류를 말해요",
      rootCause: [failing.id],
      faultType: ["firmware_update_failure"],
      weight: 20,
    },
    {
      id: "recovered",
      kind: "final_state",
      label: `${failing.name}의 실패 알람이 풀리고, 서버가 켜져 돌아와 있어요 (다시 올리거나 되돌려요)`,
      condition: recovered,
      weight: 45,
    },
    {
      id: "rest",
      kind: "final_state",
      label: `나머지 서버 ${others.length}대가 BIOS ${TARGET_BIOS}로 올라와 켜져 있어요`,
      condition: allOf(others.map((s) => upToDate(s.id, { bios: TARGET_BIOS }))),
      weight: 15,
    },
    {
      id: "no-poweroff",
      kind: "forbidden_action",
      label: "서버 전원 끄기",
      action: "power_off",
      penalty: 10,
    },
    { id: "time", kind: "time_limit", seconds: timeFor(servers.length + 1, 420), weight: 10 },
    { id: "budget", kind: "tool_budget", maxCalls: 14 + servers.length * 5, weight: 10 },
  ];
}

const firmwareFailure: ScenarioTemplate = {
  id: "firmware-failure",
  name: "펌웨어 올리다 실패했을 때",
  summary:
    "서버 한 대의 올리기가 끝에서 실패해요. 이전 버전으로 돌아온 서버를 다시 올리거나 되돌리고, 나머지는 계속 올려요.",
  difficulty: "어려움",
  faultTypes: ["firmware_update_failure"],
  unavailable: (index) =>
    biggestRack(index, 2) ? undefined : "서버가 2대 이상 든 랙이 이 세계에 없어요",
  build(index, worldId) {
    const r = biggestRack(index, 2) as Rack;
    const servers = r.servers.slice(0, FAIL_LIMIT);
    const failing = servers[1] as Entity;
    const names = servers.map((s) => s.name).join(", ");
    const flow = new Flow();
    const start = flow.add("start", "start", {});
    const fault = flow.add(
      "fault",
      "inject_fault",
      {
        faultType: "firmware_update_failure",
        target: failing.id,
        faultParams: { failures: 1 },
        durationSeconds: 0,
      },
      start,
    );
    const wait = flow.add("wait", "wait", { seconds: 60 }, fault);
    flow.add(
      "agent",
      "agent_task",
      agent(
        `점검 시간이다. ${r.rack.name}의 서버 ${servers.length}대(${names})의 BIOS를 ${TARGET_BIOS}로 올려라. 한 대가 재부팅을 마치고 돌아온 것을 확인한 다음 다음 서버를 올린다. 올리기가 실패한 서버가 있으면 이전 버전의 이미지(${imageName("bios", SHIPPED_FIRMWARE.bios)})로 되돌리거나 다시 올려서 알람을 풀고, 나머지 서버는 계속 올려라. ${images} ${REPORT.replace("faultType에는 firmware_update를", "실패가 있었으면 faultType에는 firmware_update_failure를")}`,
        14 + servers.length * 5,
        timeFor(servers.length + 1, 420) * 2,
      ),
      wait,
    );
    return doc(
      this,
      worldId,
      `${failing.name} 올리기가 한 번 실패하고, 다시 올리면 돼요.`,
      flow,
      failureSheet(servers, failing),
    );
  },
};

export const FIRMWARE_TEMPLATES: readonly ScenarioTemplate[] = [
  firmwareOne,
  firmwareRack,
  firmwareFailure,
];
