/**
 * Scenarios about configuration (REQ-068): a change somebody made, not a part that broke. The blocks make
 * ordinary operator commands, the agent's own switch commands are recognised as actions, and each built-in
 * template can be solved with the tools an agent has, and scores worse when the agent guesses.
 */
import { Catalog } from "@terrarium/core/catalog";
import {
  ACTION_LABELS,
  actionsOf,
  BLOCK_SPECS,
  describeCondition,
  emptyScenario,
  evaluate,
  matchesAction,
  NETWORK_TEMPLATES,
  NO_AGENT,
  type ScenarioDoc,
  ScenarioRunner,
  validateScenario,
} from "@terrarium/core/scenario";
import { Session } from "@terrarium/core/session";
import { TOOL_NAMES } from "@terrarium/core/tools";
import {
  type Blueprint,
  BlueprintIndex,
  isMistakeType,
  MISTAKE_SPECS,
  netModelOf,
  planOf,
  World,
} from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { gpuLab } from "../../packages/core/src/world/test-support/gpu-lab";
import { networkLab } from "../../packages/core/src/world/test-support/net-lab";
import { sampleBlueprint } from "../../packages/core/src/world/test-support/sample";

const catalog = new Catalog();

/** The network lab, with the racks' switches built as the given fabric and some switches on a chosen OS. */
function lab(fabric: "legacy" | "cloud", profiles: Record<string, string> = {}): Blueprint {
  const bp = networkLab();
  return {
    ...bp,
    entities: bp.entities.map((e) => ({
      ...e,
      props: {
        ...(e.props as Record<string, string>),
        ...(["tor-a", "tor-b", "sp1", "sp2"].includes(e.id) ? { fabric } : {}),
        ...(profiles[e.id] ? { nosProfile: profiles[e.id] } : {}),
      },
    })),
  };
}

const node = (id: string, type: string, params: Record<string, unknown>) => ({
  id,
  type,
  params: params as never,
  position: { x: 0, y: 0 },
});

/** start → one block → agent, as a person would draw it, with nothing to score. */
function oneBlock(type: string, params: Record<string, unknown>): ScenarioDoc {
  return {
    ...emptyScenario("one", "lab"),
    nodes: [
      node("start", "start", {}),
      node("b", type, params),
      node("agent", "agent_task", { prompt: "조사하라" }),
    ],
    edges: [
      { id: "e1", from: "start", port: "next", to: "b" },
      { id: "e2", from: "b", port: "next", to: "agent" },
    ],
    expectations: [{ id: "budget", kind: "tool_budget", maxCalls: 5, weight: 1 }],
  };
}

const problems = (bp: Blueprint, type: string, params: Record<string, unknown>) =>
  validateScenario(oneBlock(type, params), { index: new BlueprintIndex(bp), catalog }).filter(
    (i) => i.severity === "error",
  );

describe("what the agent does to a switch is an action [REQ-068] [REQ-034]", () => {
  test("a configuration change is an action on the switch, and a shut port names its switch", () => {
    const change = { op: "port", port: 1, cfg: { mode: "access", vlan: 100 } } as const;
    expect(actionsOf([{ type: "net.set", target: "tor-a", change }])).toEqual([
      { action: "config_change", target: "tor-a" },
    ]);
    const ends = (id: string, end: "from" | "to") => (end === "from" ? `${id}-a` : `${id}-b`);
    const [shut] = actionsOf([{ type: "link.admin", target: "l1", end: "to", down: true }], ends);
    expect(shut).toEqual({ action: "port_shutdown", target: "l1", device: "l1-b" });
    expect(matchesAction(shut as never, "port_shutdown", "l1-b")).toBe(true);
    expect(matchesAction(shut as never, "port_shutdown", "l1")).toBe(true);
    expect(matchesAction(shut as never, "port_shutdown", "l1-a")).toBe(false);
    expect(ACTION_LABELS.config_change).toBe("스위치 설정 변경");
    expect(
      describeCondition({ kind: "action_taken", action: "config_change", target: "tor-a" }),
    ).toBe("에이전트가 tor-a 스위치 설정 변경을 했어요");
  });

  test("an alarm condition by its first part matches the alarms that carry details after a dot", () => {
    const alarms = [{ code: "gpu_rail_degraded.2-7", entityId: "srv-a1", severity: "warning" }];
    const world = { stateOf: () => ({}) as never, alarms: () => alarms as never };
    const asked = (code: string, active = true) =>
      evaluate({ kind: "alarm", active, code }, world, NO_AGENT);
    expect(asked("gpu_rail_degraded")).toBe(true);
    expect(asked("gpu_rail_degraded.2-7")).toBe(true);
    expect(asked("gpu_rail")).toBe(false);
    expect(asked("gpu_rail_degraded.3")).toBe(false);
    expect(asked("gpu_rail_degraded", false)).toBe(false);
  });
});

describe("mistakes are named so a diagnosis can name them [REQ-068]", () => {
  test("each mistake has a label, is not a fault to inject, and is accepted in a diagnosis", () => {
    expect(MISTAKE_SPECS.map((m) => m.type)).toEqual([
      "port_vlan_mismatch",
      "port_shutdown",
      "svi_shutdown",
      "bgp_neighbor_shutdown",
      "route_missing",
      "outlet_off",
    ]);
    for (const m of MISTAKE_SPECS) {
      expect(m.label.length).toBeGreaterThan(2);
      expect(isMistakeType(m.type)).toBe(true);
    }
    expect(isMistakeType("cooling_unit_failure")).toBe(false);
    const faults = BLOCK_SPECS.filter((b) => b.type === "inject_fault");
    expect(faults).toHaveLength(1);
    const doc = oneBlock("wait", { seconds: 5 });
    const issues = validateScenario(
      {
        ...doc,
        expectations: [
          {
            id: "d",
            kind: "diagnosis",
            rootCause: ["tor-a"],
            faultType: ["port_vlan_mismatch"],
            weight: 10,
          },
        ],
      },
      { index: new BlueprintIndex(networkLab()), catalog },
    );
    expect(issues.filter((i) => i.severity === "error")).toEqual([]);
  });
});

describe("the configuration blocks check themselves against the network the cables design [REQ-068]", () => {
  const legacy = networkLab();
  const cloud = lab("cloud");

  test("good values pass", () => {
    expect(problems(legacy, "port_admin", { target: "tor-a", peer: "srv-a1", down: true })).toEqual(
      [],
    );
    expect(problems(legacy, "port_vlan", { target: "tor-a", peer: "srv-a1", vlan: 999 })).toEqual(
      [],
    );
    expect(problems(legacy, "svi_admin", { target: "sp1", vlan: "100", down: true })).toEqual([]);
    expect(
      problems(legacy, "route_del", { target: "core1", route: "10.0.0.0/23 via 172.16.0.0" }),
    ).toEqual([]);
    expect(problems(cloud, "bgp_admin", { target: "tor-a", peer: "sp1", down: true })).toEqual([]);
    expect(problems(legacy, "outlet_set", { target: "pdu-a", outlet: "1", on: false })).toEqual([]);
  });

  test("a value that cannot work says what is there instead", () => {
    const message = (bp: Blueprint, type: string, params: Record<string, unknown>) =>
      problems(bp, type, params)[0]?.message ?? "";
    expect(message(legacy, "port_admin", { target: "tor-a", peer: "srv-b1" })).toMatch(
      /고를 수 있는 것: .*srv-a1/,
    );
    expect(message(legacy, "port_vlan", { target: "tor-a" })).toMatch(/정해야 해요/);
    expect(message(legacy, "port_vlan", { target: "tor-a", peer: "", vlan: 5 })).toMatch(
      /아직 고르지 않았어요/,
    );
    expect(message(legacy, "svi_admin", { target: "tor-a", vlan: "100" })).toMatch(
      /VLAN 인터페이스가 하나도 없어요/,
    );
    expect(message(legacy, "svi_admin", { target: "sp1", vlan: "7" })).toMatch(
      /고를 수 있는 것: VLAN 100/,
    );
    expect(message(legacy, "bgp_admin", { target: "tor-a", peer: "sp1" })).toMatch(
      /BGP를 쓰지 않아요/,
    );
    expect(message(cloud, "bgp_admin", { target: "tor-a", peer: "core1" })).toMatch(
      /172\.16\.0\.5.*172\.16\.0\.7/,
    );
    expect(
      message(legacy, "route_del", { target: "core1", route: "10.9.0.0/16 via 172.16.0.0" }),
    ).toMatch(/고를 수 있는 것: 10\.0\.0\.0\/23/);
    expect(message(legacy, "outlet_set", { target: "pdu-a", outlet: "90" })).toMatch(
      /고를 수 있는 것: 1번/,
    );
    expect(message(legacy, "port_vlan", { target: "srv-a1", peer: "tor-a", vlan: 5 })).toMatch(
      /스위치/,
    );
  });

  test("the picker offers what the device really has, by the names people use", async () => {
    const { netChoices } = await import("@terrarium/core/scenario");
    const index = new BlueprintIndex(legacy);
    const labels = (kind: Parameters<typeof netChoices>[2], target: string) =>
      netChoices(index, catalog, kind, target).map((c) => c.label);
    expect(labels("cabled_peer", "tor-a").join("|")).toMatch(/srv-a1.*포트 \d+번/);
    expect(labels("svi_vlan", "sp1")).toEqual([
      expect.stringMatching(/^VLAN 100/),
      expect.stringMatching(/^VLAN 101/),
    ]);
    expect(netChoices(index, catalog, "static_route", "core1").map((c) => c.value)).toEqual([
      "10.0.0.0/23 via 172.16.0.0",
      "10.0.0.0/23 via 172.16.0.2",
    ]);
    expect(labels("outlet", "pdu-a")[0]).toMatch(/^1번 — srv-a1/);
    expect(netChoices(index, catalog, "bgp_peer", "tor-a")).toEqual([]);
    expect(netChoices(index, catalog, "cabled_peer", "no-such-device")).toEqual([]);
  });

  test("the blocks are in the editor's palette under the operations", () => {
    const types = BLOCK_SPECS.filter((b) => b.category === "operation").map((b) => b.type);
    for (const t of [
      "port_admin",
      "port_vlan",
      "svi_admin",
      "bgp_admin",
      "route_del",
      "outlet_set",
    ])
      expect(types).toContain(t);
  });
});

describe("running the blocks changes the world as an operator would [REQ-068]", () => {
  function run(bp: Blueprint, type: string, params: Record<string, unknown>) {
    const world = World.fromBlueprint(bp, catalog);
    const runner = new ScenarioRunner(oneBlock(type, params), world, 1, NO_AGENT);
    runner.start();
    runner.tick();
    return world;
  }

  test("a port in another VLAN, a shut port, a shut interface, a deleted route and a shut neighbor", () => {
    const vlan = run(networkLab(), "port_vlan", { target: "tor-a", peer: "srv-a1", vlan: 999 });
    expect(netModelOf(vlan).portCfg("tor-a", 1)).toEqual({ mode: "access", vlan: 999 });

    const port = run(networkLab(), "port_admin", { target: "tor-a", peer: "srv-a1", down: true });
    const cable = port.index.allLinks().find((l) => l.from === "srv-a1" && l.to === "tor-a");
    expect(port.linkAdminDown(cable?.id ?? "", "to")).toBe(true);
    const up = run(networkLab(), "port_admin", { target: "tor-a", peer: "srv-a1", down: false });
    expect(up.linkAdminDown(cable?.id ?? "")).toBe(false);

    const svi = run(networkLab(), "svi_admin", { target: "sp1", vlan: "100", down: true });
    expect(netModelOf(svi).cfg("sp1").svis.get(100)?.shut).toBe(true);
    expect(netModelOf(svi).cfg("sp2").svis.get(100)?.shut).toBe(false);

    const route = run(networkLab(), "route_del", {
      target: "core1",
      route: "10.0.0.0/23 via 172.16.0.0",
    });
    expect(
      netModelOf(route)
        .cfg("core1")
        .routes.map((r) => r.via),
    ).toEqual(["172.16.0.2"]);

    const bgp = run(lab("cloud"), "bgp_admin", {
      target: "tor-a",
      peer: "sp1",
      down: true,
    });
    expect(netModelOf(bgp).sessionState("tor-a", "172.16.0.5")).toBe("shutdown");

    const outlet = run(networkLab(), "outlet_set", { target: "pdu-a", outlet: "1", on: false });
    expect(outlet.stateAs("pdu-a", "pdu").outletsOff).toEqual([1]);
  });
});

/** What a template needs: the world it is meant for, how to fix it, and the alarm that shows it. */
interface Case {
  readonly id: string;
  readonly world: () => Blueprint;
  readonly alarm: string;
  readonly fix: (session: Session, doc: ScenarioDoc) => void;
}

const cli = (session: Session, device: string, commands: string[]) =>
  session.call("network_cli", { device, commands, configure: true });

const CASES: readonly Case[] = [
  {
    id: "wrong-vlan-port",
    world: networkLab,
    alarm: "host_unreachable",
    fix: (s) => cli(s, "tor-a", ["interface Ethernet1/1", "switchport access vlan 100"]),
  },
  {
    id: "port-shut-by-mistake",
    world: networkLab,
    alarm: "link_down",
    fix: (s) => cli(s, "tor-a", ["interface Ethernet1/1", "no shutdown"]),
  },
  {
    id: "gateway-interface-shut",
    world: networkLab,
    alarm: "host_unreachable",
    fix: (s) => {
      cli(s, "sp1", ["interface Vlan100", "no shutdown"]);
      cli(s, "sp2", ["interface Vlan100", "no shutdown"]);
    },
  },
  {
    id: "static-route-removed",
    world: networkLab,
    alarm: "host_unreachable",
    fix: (s) =>
      cli(s, "core1", ["ip route 10.0.0.0/23 172.16.0.0", "ip route 10.0.0.0/23 172.16.0.2"]),
  },
  {
    id: "bgp-neighbor-shut",
    world: () => lab("cloud", { "tor-a": "eos/4.32" }),
    alarm: "bgp_session_down",
    fix: (s) => {
      const asn = planOf(s.world.index, catalog).bgp.get("tor-a")?.asn;
      cli(s, "tor-a", [`router bgp ${asn}`, "no neighbor 172.16.0.5 shutdown"]);
    },
  },
  {
    id: "gpu-rail-port-shut",
    world: gpuLab,
    alarm: "gpu_rail_degraded",
    fix: (s) => cli(s, "rail3", ["interface Ethernet1", "no shutdown"]),
  },
  {
    id: "pdu-outlet-off",
    world: sampleBlueprint,
    alarm: "server_power_lost",
    fix: (s) =>
      s.call("redfish_request", {
        server: "pdu-a",
        method: "POST",
        path: "/redfish/v1/PowerEquipment/RackPDUs/1/Outlets/1/Actions/Outlet.PowerControl",
        body: { PowerState: "On" },
      }),
  },
];

function begin(c: Case) {
  const template = NETWORK_TEMPLATES.find((t) => t.id === c.id);
  if (!template) throw new Error(c.id);
  const bp = c.world();
  const index = new BlueprintIndex(bp);
  expect(template.unavailable(index)).toBeUndefined();
  const doc = template.build(index, "lab");
  const session = Session.create({ blueprint: bp, scenario: doc, tools: TOOL_NAMES, seed: 1 });
  session.start();
  return { doc, session, index, template };
}

const diagnosisOf = (doc: ScenarioDoc) =>
  doc.expectations.find((e) => e.kind === "diagnosis") as Extract<
    ScenarioDoc["expectations"][number],
    { kind: "diagnosis" }
  >;

describe.each(CASES)("template $id [REQ-068] [REQ-033]", (c) => {
  test("it is a valid scenario whose prompt tells the symptom and never the answer", () => {
    const { doc, index, template } = begin(c);
    expect(validateScenario(doc, { index, catalog })).toEqual([]);
    expect(doc).toMatchObject({ id: c.id, template: c.id });
    const prompt = String(doc.nodes.find((n) => n.type === "agent_task")?.params.prompt);
    expect(prompt).toContain("submit_diagnosis");
    for (const type of template.mistakeTypes ?? []) {
      const label = MISTAKE_SPECS.find((m) => m.type === type)?.label ?? "";
      expect(prompt).not.toContain(type);
      expect(prompt).not.toContain(label);
    }
    for (const root of diagnosisOf(doc).rootCause) expect(prompt).not.toContain(root);
  });

  test("by the time the agent is handed the task the alarm is there to be found", () => {
    const { session } = begin(c);
    const found = session.call("list_alarms", {});
    const codes = (found.data as Array<{ code: string }>).map((a) => a.code);
    expect(codes.some((code) => code === c.alarm || code.startsWith(`${c.alarm}.`))).toBe(true);
  });

  test("putting the change right with the switch's own commands earns the points", () => {
    const { doc, session } = begin(c);
    c.fix(session, doc);
    const root = diagnosisOf(doc);
    const done = session.call("submit_diagnosis", {
      rootCause: root.rootCause[0],
      faultType: root.faultType[0],
      summary: "작업 중 바뀐 설정을 되돌렸어요",
    });
    expect(done).toMatchObject({ ok: true, ended: "diagnosed" });
    const { score } = session.finish();
    const lost = score.items.filter((i) => i.verdict !== "pass" && i.verdict !== "clean");
    expect(lost.map((i) => `${i.id}: ${i.detail}`)).toEqual([]);
    expect(score.total).toBeGreaterThanOrEqual(95);
  });

  test("switching a server off and guessing scores much less", () => {
    const { session } = begin(c);
    session.call("power_server", { id: "srv-a2", action: "off" });
    session.call("submit_diagnosis", {
      rootCause: "srv-a2",
      faultType: "cpu_runaway",
      summary: "서버 문제 같아요",
    });
    const { score } = session.finish();
    expect(score.passed).toBe(false);
    expect(score.total).toBeLessThan(40);
  });
});

describe("a template that has nothing to act on says so [REQ-068]", () => {
  test("worlds without the right network or equipment are refused with a reason", () => {
    const sample = new BlueprintIndex(sampleBlueprint());
    const why = (id: string) => NETWORK_TEMPLATES.find((t) => t.id === id)?.unavailable(sample);
    expect(why("wrong-vlan-port")).toMatch(/위쪽 스위치에 이어진 서버가 없어요/);
    expect(why("gateway-interface-shut")).toMatch(/VLAN 인터페이스가 없어요/);
    expect(why("static-route-removed")).toMatch(/라우터/);
    expect(why("bgp-neighbor-shut")).toMatch(/BGP/);
    expect(why("gpu-rail-port-shut")).toMatch(/레일/);
    expect(why("pdu-outlet-off")).toBeUndefined();
    const legacyOnly = new BlueprintIndex(networkLab());
    expect(
      NETWORK_TEMPLATES.find((t) => t.id === "bgp-neighbor-shut")?.unavailable(legacyOnly),
    ).toMatch(/BGP/);
    expect(() => NETWORK_TEMPLATES[4]?.build(sample, "x")).toThrow(/BGP/);
  });
});
