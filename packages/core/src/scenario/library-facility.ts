/**
 * Facility scenarios (REQ-033, REQ-044, REQ-046): incidents in the plant, the liquid loop and the
 * power chain. They need equipment the plain sample hall does not have, so each says why it cannot be
 * built for a world without it. The prompts describe symptoms only.
 */
import { withJosa } from "@terrarium/core/kernel";
import type { BlueprintIndex, Entity } from "@terrarium/core/world";
import { agent, byLinks, doc, Flow, needs, type ScenarioTemplate, SUBMIT } from "./library-kit";

/** The plants that share consumers with `plant`: one loop, which fails together when its controls do. */
function loopOf(index: BlueprintIndex, plant: Entity): Entity[] {
  const consumers = index.incoming(plant.id, "cooling").map((l) => l.from);
  const ids = new Set<string>([plant.id]);
  for (const consumer of consumers)
    for (const l of index.outgoing(consumer, "cooling"))
      if (index.entity(l.to).kind === "chiller") ids.add(l.to);
  return [...ids].sort().map((id) => index.entity(id));
}

const chillerLoop: ScenarioTemplate = {
  id: "plant-loop-down",
  name: "냉각 플랜트 루프 정지",
  summary: "냉수(또는 냉각수) 루프의 플랜트가 함께 멈춰 공조기와 CDU의 공급 온도가 오른다.",
  difficulty: "어려움",
  faultTypes: ["chiller_failure"],
  unavailable: (index) => needs(index, ["chiller", "server"]),
  build(index, worldId) {
    const busiest = byLinks(
      index,
      "chiller",
      (c) => index.incoming(c.id, "cooling").length,
    ) as Entity;
    const plants = loopOf(index, busiest);
    const flow = new Flow();
    let previous = flow.add("start", "start", {});
    for (const plant of plants)
      previous = flow.add(
        `fault-${plant.id}`,
        "inject_fault",
        { faultType: "chiller_failure", target: plant.id, durationSeconds: 0 },
        previous,
      );
    const wait = flow.add("wait", "wait", { seconds: 1200 }, previous);
    flow.add(
      "agent",
      "agent_task",
      agent(
        `여러 방에서 흡기 온도 경고가 번지고, 액체 냉각 설비의 공급 온도도 오르고 있다. 건물 설비 쪽 원인을 찾아라. ${SUBMIT}`,
        40,
        3600,
      ),
      wait,
    );
    return doc(
      this,
      worldId,
      `${plants.map((p) => p.name).join(", ")}이(가) 함께 멈춘다. 이 루프에 매달린 설비 ${index.incoming(busiest.id, "cooling").length}개.`,
      flow,
      [
        {
          id: "diagnosis",
          kind: "diagnosis",
          rootCause: plants.map((p) => p.id),
          faultType: ["chiller_failure"],
          weight: 55,
        },
        {
          id: "no-server-power",
          kind: "forbidden_action",
          label: "원인과 무관한 서버 전원 끄기",
          action: "power_off",
          penalty: 15,
        },
        { id: "time", kind: "time_limit", seconds: 2400, weight: 15 },
        { id: "budget", kind: "tool_budget", maxCalls: 35, weight: 15 },
      ],
    );
  },
};

const cduFailure: ScenarioTemplate = {
  id: "cdu-failure",
  name: "CDU 정지와 수랭 서버 열 폭주",
  summary: "수랭 랙을 맡은 CDU가 멈춰 GPU 서버가 스로틀링하다 열 보호로 꺼진다.",
  difficulty: "보통",
  faultTypes: ["cdu_failure"],
  unavailable: (index) => needs(index, ["cdu", "server"]),
  build(index, worldId) {
    const cdu = byLinks(index, "cdu", (c) => index.incoming(c.id, "cooling").length) as Entity;
    const racks = index.incoming(cdu.id, "cooling").map((l) => index.entity(l.from));
    const flow = new Flow();
    const start = flow.add("start", "start", {});
    const fault = flow.add(
      "fault",
      "inject_fault",
      { faultType: "cdu_failure", target: cdu.id, durationSeconds: 0 },
      start,
    );
    const wait = flow.add("wait", "wait", { seconds: 240 }, fault);
    flow.add(
      "agent",
      "agent_task",
      agent(
        `GPU 서버들이 스로틀링하고 일부는 열 보호로 꺼졌다는 신고가 들어왔다. 공조 온도는 정상이다. ${SUBMIT}`,
      ),
      wait,
    );
    return doc(
      this,
      worldId,
      `${withJosa(cdu.name, "이")} 멈춘다. 냉각수를 받는 랙 ${racks.length}개.`,
      flow,
      [
        {
          id: "diagnosis",
          kind: "diagnosis",
          rootCause: [cdu.id],
          faultType: ["cdu_failure"],
          weight: 60,
        },
        {
          id: "no-restart",
          kind: "forbidden_action",
          label: "냉각이 돌아오기 전에 서버를 다시 켜기",
          action: "power_on",
          penalty: 10,
        },
        { id: "time", kind: "time_limit", seconds: 1200, weight: 15 },
        { id: "budget", kind: "tool_budget", maxCalls: 30, weight: 15 },
      ],
    );
  },
};

/** The upstream a transfer switch takes utility power from, followed to its root (the switch itself when none). */
function utilityRoot(index: BlueprintIndex, start: Entity): Entity {
  let node = start;
  for (let hops = 0; hops < 12; hops++) {
    const up = index
      .outgoing(node.id, "power")
      .map((l) => index.entity(l.to))
      .find((e) => e.kind !== "generator");
    if (!up) return node;
    node = up;
  }
  return node;
}

const generatorFailure: ScenarioTemplate = {
  id: "outage-generator-fails",
  name: "정전과 발전기 기동 실패",
  summary: "수전이 끊기고 발전기가 기동하지 못한다. UPS 배터리가 바닥나기 전에 원인을 찾아야 한다.",
  difficulty: "어려움",
  faultTypes: ["utility_outage", "generator_start_failure"],
  unavailable: (index) => needs(index, ["generator", "ups", "server"]),
  build(index, worldId) {
    const gen = byLinks(index, "generator", (g) => index.incoming(g.id, "power").length) as Entity;
    const switches = index
      .incoming(gen.id, "power")
      .map((l) => index.entity(l.from))
      .filter((e) => e.kind === "power_panel");
    const first = switches[0] ?? gen;
    const root = utilityRoot(index, first);
    // Every machine the switches can fall back on fails, spares included, or the spare would carry on.
    const gens = [
      ...new Set(
        switches.flatMap((s) =>
          index
            .outgoing(s.id, "power")
            .map((l) => l.to)
            .filter((id) => index.entity(id).kind === "generator"),
        ),
      ),
    ]
      .sort()
      .map((id) => index.entity(id));
    const failing = gens.length > 0 ? gens : [gen];
    const flow = new Flow();
    let previous = flow.add("start", "start", {});
    for (const g of failing)
      previous = flow.add(
        `fault-${g.id}`,
        "inject_fault",
        { faultType: "generator_start_failure", target: g.id, durationSeconds: 0 },
        previous,
      );
    const outage = flow.add(
      "outage",
      "inject_fault",
      { faultType: "utility_outage", target: root.id, durationSeconds: 0 },
      previous,
    );
    const wait = flow.add("wait", "wait", { seconds: 120 }, outage);
    flow.add(
      "agent",
      "agent_task",
      agent(
        `정전 알람이 올라왔다. UPS가 배터리로 버티고 있고 방전이 진행 중이다. 전원 계통을 따라 원인을 찾아라. ${SUBMIT}`,
        30,
        1800,
      ),
      wait,
    );
    return doc(
      this,
      worldId,
      `${withJosa(root.name, "이")} 정전되고 ${failing.map((g) => g.name).join(", ")}이(가) 기동하지 못한다.`,
      flow,
      [
        {
          id: "diagnosis",
          kind: "diagnosis",
          rootCause: [...failing.map((g) => g.id), root.id],
          faultType: ["utility_outage", "generator_start_failure"],
          weight: 60,
        },
        { id: "time", kind: "time_limit", seconds: 900, weight: 25 },
        { id: "budget", kind: "tool_budget", maxCalls: 25, weight: 15 },
      ],
    );
  },
};

export const FACILITY_TEMPLATES: readonly ScenarioTemplate[] = [
  chillerLoop,
  cduFailure,
  generatorFailure,
];
