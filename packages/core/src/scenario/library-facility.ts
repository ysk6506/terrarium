/**
 * Facility scenarios (REQ-033, REQ-044, REQ-046): incidents in the plant, the liquid loop and the
 * power chain. They need equipment the plain sample hall does not have, so each says why it cannot be
 * built for a world without it. The prompts describe symptoms only.
 */

import type { Catalog } from "@terrarium/core/catalog";
import { withJosa } from "@terrarium/core/kernel";
import type { BlueprintIndex, Entity } from "@terrarium/core/world";
import {
  agent,
  allOf,
  byLinks,
  doc,
  Flow,
  needs,
  powered,
  type ScenarioTemplate,
  SUBMIT,
} from "./library-kit";
import type { Expectation } from "./model";
import { builtinCatalog } from "./net-blocks";

/** The plants that share consumers with `plant`: one loop, which fails together when its controls do. */
function loopOf(index: BlueprintIndex, plant: Entity): Entity[] {
  const consumers = index.incoming(plant.id, "cooling").map((l) => l.from);
  const ids = new Set<string>([plant.id]);
  for (const consumer of consumers)
    for (const l of index.outgoing(consumer, "cooling"))
      if (index.entity(l.to).kind === "chiller") ids.add(l.to);
  return [...ids].sort().map((id) => index.entity(id));
}

/** Every machine the switches can fall back on fails, spares included, or the spare would carry on. */
function failingGenerators(
  index: BlueprintIndex,
  gen: Entity,
  switches: readonly Entity[],
): Entity[] {
  const ids = new Set(
    switches.flatMap((s) =>
      index
        .outgoing(s.id, "power")
        .map((l) => l.to)
        .filter((id) => index.entity(id).kind === "generator"),
    ),
  );
  const gens = [...ids].sort().map((id) => index.entity(id));
  return gens.length > 0 ? gens : [gen];
}

const chillerLoop: ScenarioTemplate = {
  id: "plant-loop-down",
  name: "냉각 플랜트 루프 정지",
  summary: "냉수(또는 냉각수) 루프의 플랜트가 함께 멈춰 공조기와 CDU의 공급 온도가 올라요.",
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
        `냉수를 받는 공조기와 액체 냉각 설비의 공급 온도가 오르고 있다. 건물 설비 쪽 원인을 찾아라. ${SUBMIT}`,
        40,
        3600,
      ),
      wait,
    );
    return doc(
      this,
      worldId,
      `${plants.map((p) => p.name).join(", ")}이(가) 함께 멈춰요. 이 루프에 매달린 설비 ${index.incoming(busiest.id, "cooling").length}개.`,
      flow,
      [
        {
          id: "diagnosis",
          kind: "diagnosis",
          rootCause: plants.map((p) => p.id),
          faultType: ["chiller_failure"],
          weight: 55,
        },
        { id: "time", kind: "time_limit", seconds: 2400, weight: 15 },
        { id: "budget", kind: "tool_budget", maxCalls: 35, weight: 15 },
      ],
    );
  },
};

/**
 * The direct-liquid-cooled servers a CDU feeds, which are the ones that overheat when it stops (an immersion tank
 * keeps its fluid's heat for a long time); all the servers it cools when none of them is direct-liquid.
 */
function liquidServers(index: BlueprintIndex, cdu: Entity, catalog: Catalog): Entity[] {
  const racks = index.incoming(cdu.id, "cooling").map((l) => l.from);
  const all = racks
    .flatMap((r) => index.descendants(r).filter((e) => e.kind === "server"))
    .sort((a, b) => a.id.localeCompare(b.id));
  const direct = all.filter(
    (s) => s.modelId !== undefined && catalog.getOf(s.modelId, "server").cooling === "dlc",
  );
  return direct.length > 0 ? direct : all;
}

/** How many of a CDU's servers the sheet names: enough to show the heat, few enough to read. */
const WATCHED_SERVERS = 4;

/** CPU temperature the liquid-cooled servers must be brought below once their coolant is gone, °C. */
const SAFE_CPU_C = 60;

/**
 * What an operator does about a CDU that cannot be restarted from here: take the liquid-cooled servers it fed out of
 * service before they cook. The sheet scores the outcome (their CPUs cool down), the action (power off), and
 * forbids bringing them back before the coolant returns. Restarting the CDU itself is not forbidden.
 */
function cduOperation(servers: readonly Entity[]): Expectation[] {
  if (servers.length === 0) return [];
  return [
    {
      id: "cpu-cool",
      kind: "final_state",
      label: `수랭 서버 CPU가 ${SAFE_CPU_C}°C 아래로 내려가요`,
      condition: allOf(
        servers.map((s) => ({
          kind: "state",
          entity: s.id,
          field: "cpuC",
          op: "<",
          value: SAFE_CPU_C,
        })),
      ),
      weight: 25,
    },
    ...servers.map(
      (s): Expectation => ({
        id: `shed-${s.id}`,
        kind: "required_action",
        label: `${s.name} 전원 끄기`,
        action: "power_off",
        target: s.id,
        weight: 10 / servers.length,
      }),
    ),
    ...servers.map(
      (s): Expectation => ({
        id: `no-restart-${s.id}`,
        kind: "forbidden_action",
        label: `냉각이 돌아오기 전에 ${s.name} 다시 켜기`,
        action: "power_on",
        target: s.id,
        penalty: 10,
      }),
    ),
  ];
}

const cduFailure: ScenarioTemplate = {
  id: "cdu-failure",
  name: "CDU 정지와 수랭 서버 열 폭주",
  summary: "수랭 랙을 맡은 CDU가 멈춰 수랭 서버의 CPU 온도가 계속 올라요.",
  difficulty: "보통",
  faultTypes: ["cdu_failure"],
  unavailable: (index) => needs(index, ["cdu", "server"]),
  build(index, worldId, catalog) {
    const cdu = byLinks(index, "cdu", (c) => index.incoming(c.id, "cooling").length) as Entity;
    const racks = index.incoming(cdu.id, "cooling").map((l) => index.entity(l.from));
    const watched = liquidServers(index, cdu, catalog ?? builtinCatalog()).slice(
      0,
      WATCHED_SERVERS,
    );
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
      agent(`수랭 서버들의 CPU 온도가 계속 오르고 있다. 공조 온도는 정상이다. ${SUBMIT}`),
      wait,
    );
    return doc(
      this,
      worldId,
      `${withJosa(cdu.name, "이")} 멈춰요. 냉각수를 받는 랙 ${racks.length}개.`,
      flow,
      [
        {
          id: "diagnosis",
          kind: "diagnosis",
          rootCause: [cdu.id],
          faultType: ["cdu_failure"],
          weight: 45,
        },
        ...cduOperation(watched),
        { id: "time", kind: "time_limit", seconds: 1200, weight: 10 },
        { id: "budget", kind: "tool_budget", maxCalls: 30, weight: 10 },
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

/** The UPS a device draws its power through, following the power cables upstream (undefined when none stands in the way). */
function upsBehind(index: BlueprintIndex, id: string): Entity | undefined {
  const seen = new Set<string>([id]);
  for (let queue = [id]; queue.length > 0; ) {
    const next: string[] = [];
    for (const from of queue)
      for (const l of index.outgoing(from, "power")) {
        if (seen.has(l.to)) continue;
        seen.add(l.to);
        const up = index.entity(l.to);
        if (up.kind === "ups") return up;
        next.push(l.to);
      }
    queue = next;
  }
  return undefined;
}

/** How much of its battery a degraded UPS keeps (the fault block's `factor`). */
const BATTERY_FACTOR = 0.1;
/** The battery must last at least this long at the load left on it, minutes. */
const HOLD_MINUTES = 20;
/** And the charge left when the run ends, %. */
const HOLD_PCT = 20;

/** Whether a server stands in a liquid-cooled rack or an immersion tank (one wired to a CDU). */
function isLiquidCooled(index: BlueprintIndex, server: Entity): boolean {
  const rack = index.find(server.parentId ?? "");
  return rack
    ? index.outgoing(rack.id, "cooling").some((l) => index.entity(l.to).kind === "cdu")
    : false;
}

/** The servers behind each UPS, the biggest group first. */
function serversByUps(index: BlueprintIndex, servers: readonly Entity[]) {
  const behind = new Map<string, { ups: Entity; servers: Entity[] }>();
  for (const server of servers) {
    const ups = upsBehind(index, server.id);
    if (!ups) continue;
    const entry = behind.get(ups.id) ?? { ups, servers: [] };
    entry.servers.push(server);
    behind.set(ups.id, entry);
  }
  return [...behind.values()].sort(
    (a, b) => b.servers.length - a.servers.length || a.ups.id.localeCompare(b.ups.id),
  );
}

/**
 * The UPS the outage is about and the servers it must keep fed: the UPS behind the liquid-cooled and immersion
 * servers (the ones that cannot ride out a dead battery), or the one behind the most servers when the world has none.
 */
function protectedLoad(index: BlueprintIndex): { ups: Entity; servers: Entity[] } | undefined {
  const all = index.ofKind("server");
  const best =
    serversByUps(
      index,
      all.filter((s) => isLiquidCooled(index, s)),
    )[0] ?? serversByUps(index, all)[0];
  return best && { ups: best.ups, servers: best.servers.slice(0, WATCHED_SERVERS) };
}

/**
 * The most load the UPS may still carry for its (degraded) battery to last `HOLD_MINUTES`, W. A degraded battery
 * dies in minutes at full load; shedding load is the only way to buy time, and this is how much has to go.
 */
function holdableLoadW(ups: Entity, catalog: Catalog): number {
  const model = catalog.getOf(ups.modelId ?? "", "ups");
  return Math.round((model.batteryKwh * 1000 * BATTERY_FACTOR * 60) / HOLD_MINUTES);
}

/** What an operator does once the generator will not start: shed load so the battery lasts, and keep the critical servers fed. */
function outageOperation(held: ReturnType<typeof protectedLoad>, catalog: Catalog): Expectation[] {
  if (!held) return [];
  const limitW = holdableLoadW(held.ups, catalog);
  return [
    {
      id: "battery-holds",
      kind: "final_state",
      label: `UPS 배터리가 ${HOLD_MINUTES}분 버틸 만큼 부하가 줄고, 중요 서버는 전원이 끊기지 않아요`,
      condition: {
        kind: "all",
        of: [
          { kind: "state", entity: held.ups.id, field: "batteryPct", op: ">=", value: HOLD_PCT },
          { kind: "state", entity: held.ups.id, field: "loadW", op: "<=", value: limitW },
          allOf(held.servers.map((s) => powered(s.id))),
        ],
      },
      weight: 25,
    },
    {
      id: "shed-load",
      kind: "required_action",
      label: "부하 줄이기 (서버 전원 끄기)",
      action: "power_off",
      weight: 10,
    },
  ];
}

const generatorFailure: ScenarioTemplate = {
  id: "outage-generator-fails",
  name: "정전과 발전기 기동 실패",
  summary: "수전이 끊기고 발전기가 기동하지 못해요. UPS 배터리가 바닥나기 전에 원인을 찾아야 해요.",
  difficulty: "어려움",
  faultTypes: ["utility_outage", "generator_start_failure"],
  unavailable: (index) => needs(index, ["generator", "ups", "server"]),
  build(index, worldId, catalog) {
    const gen = byLinks(index, "generator", (g) => index.incoming(g.id, "power").length) as Entity;
    const switches = index
      .incoming(gen.id, "power")
      .map((l) => index.entity(l.from))
      .filter((e) => e.kind === "power_panel");
    const first = switches[0] ?? gen;
    const root = utilityRoot(index, first);
    const failing = failingGenerators(index, gen, switches);
    const flow = new Flow();
    let previous = flow.add("start", "start", {});
    for (const g of failing)
      previous = flow.add(
        `fault-${g.id}`,
        "inject_fault",
        { faultType: "generator_start_failure", target: g.id, durationSeconds: 0 },
        previous,
      );
    // A worn battery is what makes the minutes count: it dies long before the operator can wait for anything.
    const held = protectedLoad(index);
    if (held)
      previous = flow.add(
        `fault-${held.ups.id}`,
        "inject_fault",
        {
          faultType: "ups_battery_degraded",
          target: held.ups.id,
          faultParams: { factor: BATTERY_FACTOR },
          durationSeconds: 0,
        },
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
      `${withJosa(root.name, "이")} 정전되고 ${failing.map((g) => g.name).join(", ")}이(가) 기동하지 못해요.`,
      flow,
      [
        {
          id: "diagnosis",
          kind: "diagnosis",
          rootCause: [...failing.map((g) => g.id), root.id],
          faultType: ["utility_outage", "generator_start_failure"],
          weight: 45,
        },
        ...outageOperation(held, catalog ?? builtinCatalog()),
        { id: "time", kind: "time_limit", seconds: 900, weight: 10 },
        { id: "budget", kind: "tool_budget", maxCalls: 25, weight: 10 },
      ],
    );
  },
};

export const FACILITY_TEMPLATES: readonly ScenarioTemplate[] = [
  chillerLoop,
  cduFailure,
  generatorFailure,
];
