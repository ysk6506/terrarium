import {
  ALL_SCENARIO_TEMPLATES,
  CONTROL_ROWS,
  emptyScenario,
  FAULT_RESPONSES,
  type ScenarioDoc,
} from "@terrarium/core/scenario";
import { BlueprintIndex, FAULT_SPECS, MISTAKE_SPECS } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { sampleBlueprint } from "../world/test-support/sample";
import {
  actionLabel,
  actionsFor,
  deriveNeeds,
  deriveUse,
  faultTypesOf,
  PHYSICAL_ACTION,
  TASK_ACTIONS,
} from ".";

const known = new Set([...CONTROL_ROWS.map((r) => r.id), PHYSICAL_ACTION]);

describe("고장마다 풀 액션이 있다 [REQ-112]", () => {
  test("[REQ-112] 모든 고장 종류는 알려진 액션 하나 이상으로 이어진다 (새 고장 종류가 생기면 여기서 걸린다)", () => {
    for (const spec of FAULT_SPECS) {
      const ids = actionsFor(spec.type);
      expect(ids.length, `${spec.type}에 풀 액션이 없어요`).toBeGreaterThan(0);
      for (const id of ids) expect(known.has(id), `${spec.type} → ${id}`).toBe(true);
    }
  });

  test("[REQ-112] 모든 설정 실수와 일 종류도 액션이 있고, 원격으로 못 푸는 고장은 물리 처리다", () => {
    for (const m of MISTAKE_SPECS)
      for (const id of actionsFor(m.type)) expect(known.has(id)).toBe(true);
    for (const t of Object.keys(TASK_ACTIONS)) expect(actionsFor(t).length).toBeGreaterThan(0);
    expect(actionsFor("disk_failure")).toEqual([PHYSICAL_ACTION]);
    expect(actionsFor("breaker_trip")).toEqual(["breaker.reset"]);
    expect(actionsFor("없는_고장")).toEqual([]);
    for (const [type, r] of Object.entries(FAULT_RESPONSES))
      expect(actionsFor(type)).toEqual(r.via.length > 0 ? r.via : [PHYSICAL_ACTION]);
  });
});

describe("세계가 E2E로 가려면 [REQ-112]", () => {
  const blueprint = sampleBlueprint();
  const index = new BlueprintIndex(blueprint);
  const docs: ScenarioDoc[] = ALL_SCENARIO_TEMPLATES.filter((t) => !t.unavailable(index)).map((t) =>
    t.build(index, blueprint.id),
  );

  test("[REQ-112] 시나리오 정의에서 객체·링크·액션을 뽑고 고장은 처음 만난 순서다", () => {
    expect(docs.length).toBeGreaterThan(3);
    const needs = deriveNeeds(docs, blueprint);
    expect(needs.scenarios).toBe(docs.length);
    expect(needs.actions.length).toBeGreaterThan(0);
    expect(needs.objects.length).toBeGreaterThan(0);
    expect(needs.links.length).toBeGreaterThan(0);
    for (const a of needs.actions) {
      expect(a.label).toBe(actionLabel(a.id));
      expect(a.faults.length).toBeGreaterThan(0);
      expect(a.scenarios).toBeGreaterThan(0);
    }
    const sorted = [...needs.actions].sort((x, y) => y.faults.length - x.faults.length);
    expect(needs.actions.map((a) => a.faults.length)).toEqual(sorted.map((a) => a.faults.length));
    // every object counted is in the world
    for (const o of needs.objects) expect(o.count).toBeGreaterThan(0);
  });

  test("[REQ-112] 시나리오가 없으면 요구도 비어 있다", () => {
    const needs = deriveNeeds([], blueprint);
    expect(needs).toMatchObject({ scenarios: 0, objects: [], links: [], actions: [] });
    expect(faultTypesOf(emptyScenario("s", blueprint.id))).toEqual([]);
  });

  test("[REQ-112] 쓴 것: 승인 뒤의 액션, 물리로 간 액션, 한 번도 안 쓴 액션을 센다", () => {
    const needs = deriveNeeds(docs, blueprint);
    const server = blueprint.entities.find((e) => e.kind === "server")?.id as string;
    const call = (tool: string, effects: { action: string; target: string }[] = []) => ({
      t: 1,
      tool,
      args: {},
      ok: true,
      effects: effects as never,
    });
    const run = {
      toolCalls: [
        call("get_server"),
        call("ask_human"),
        call("power_server", [{ action: "power_off", target: server }]),
        call("power_server", [{ action: "power_on", target: server }]),
      ],
      events: [],
    };
    const use = deriveUse(needs, [run], blueprint);
    const power = use.actions.find((a) => a.id === "power.server");
    if (power) {
      expect(power.counts).toMatchObject({ approved: 1, agent: 1 });
      expect(power.alwaysApproved).toBe(false);
    }
    const unused = use.actions.filter((a) => a.doer === "none");
    expect(use.byDoer.none).toBe(unused.length);
    expect(use.runs).toBe(1);
  });

  test("[REQ-112] 항상 승인으로 간 액션은 키네틱 층의 승인 액션으로 설계하라고 말한다", () => {
    const needs = {
      scenarios: 1,
      objects: [],
      links: [],
      actions: [{ id: "vm.migrate", label: "VM 옮기기", targets: [], faults: [], scenarios: 1 }],
    };
    const vm = blueprint.entities.find((e) => e.kind === "vm")?.id ?? "vm-x";
    const calls = [
      { t: 1, tool: "ask_human", args: {}, ok: true },
      {
        t: 2,
        tool: "vcenter_request",
        args: {},
        ok: true,
        effects: [{ action: "vm_migrate", target: vm }] as never,
      },
    ];
    const use = deriveUse(needs, [{ toolCalls: calls, events: [] }], blueprint);
    expect(use.alwaysApproved).toBe(1);
    expect(use.line).toBe(
      "항상 승인으로 간 액션 1개는 키네틱 층에서 승인 액션으로 설계할 것이에요.",
    );
    expect(use.actions[0]).toMatchObject({ doer: "approved", total: 1 });
    expect(deriveUse(needs, [], blueprint).line).toBe(
      "이 실험은 세계를 바꾸는 액션을 쓰지 않았어요.",
    );
  });

  test("[REQ-112] 시나리오가 필요로 하지 않은 액션을 에이전트가 썼으면 필요한 것 뒤에 따로 붙는다", () => {
    const needs = {
      scenarios: 1,
      objects: [],
      links: [],
      actions: [
        {
          id: PHYSICAL_ACTION,
          label: "현장 점검·부품 교체",
          targets: [],
          faults: [],
          scenarios: 1,
        },
      ],
    };
    const vm = blueprint.entities.find((e) => e.kind === "vm")?.id ?? "vm-x";
    const calls = [
      {
        t: 1,
        tool: "vcenter_request",
        args: {},
        ok: true,
        effects: [{ action: "vm_migrate", target: vm }] as never,
      },
    ];
    const use = deriveUse(needs, [{ toolCalls: calls, events: [] }], blueprint);
    expect(use.actions.map((a) => [a.id, a.needed, a.total])).toEqual([
      [PHYSICAL_ACTION, true, 0],
      ["vm.migrate", false, 1],
    ]);
    expect(use.byDoer).toMatchObject({ agent: 1, none: 1 });
  });

  test("[REQ-112] 물리로 넘긴 고장은 현장 처리 액션을 물리로 센다", () => {
    const needs = {
      scenarios: 1,
      objects: [],
      links: [],
      actions: [
        {
          id: PHYSICAL_ACTION,
          label: "현장 점검·부품 교체",
          targets: [],
          faults: [],
          scenarios: 1,
        },
      ],
    };
    const events = [
      {
        kind: "counterpart",
        what: "handed",
        seq: 0,
        t: 5,
        handoff: "h",
        domain: "server",
        team: "서버 팀",
        summary: "",
        faults: [
          {
            faultId: "f",
            faultType: "disk_failure",
            target: "s",
            etaSeconds: 60,
            doneAt: 65,
            startsAt: 5,
            kind: "part",
            onSite: true,
            who: "team",
          },
        ],
      },
    ];
    const use = deriveUse(needs, [{ toolCalls: [], events: events as never }], blueprint);
    expect(use.actions[0]?.counts.physical).toBe(1);
    expect(use.actions[0]?.doer).toBe("physical");
  });
});
