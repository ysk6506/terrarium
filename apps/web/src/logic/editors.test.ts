import { Catalog } from "@terrarium/core/catalog";
import { type Experiment, normalizeTools } from "@terrarium/core/experiments";
import {
  emptyScenario,
  paletteFor,
  SCENARIO_TEMPLATES,
  validateScenario,
} from "@terrarium/core/scenario";
import { BlueprintIndex } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { sampleBlueprint } from "../../../../packages/core/src/world/test-support/sample";
import { experiment as ex, lineChart, niceTicks, scenario as sc, scoreBar } from ".";

const index = new BlueprintIndex(sampleBlueprint());
const catalog = new Catalog();
const palette = paletteFor(index);
const item = (key: string) => palette.find((p) => p.key === key) as (typeof palette)[number];
const template = (id: string) =>
  (SCENARIO_TEMPLATES.find((t) => t.id === id) as (typeof SCENARIO_TEMPLATES)[number]).build(
    index,
    "sample",
  );

describe("the scenario canvas [REQ-034]", () => {
  test("a template becomes nodes and wires, each node saying what it does and what is wrong with it", () => {
    const doc = template("cooling-failure");
    const issues = validateScenario(doc, { index, catalog });
    const { nodes, edges } = sc.toFlow(
      doc,
      [...issues, { code: "X", severity: "warning", message: "주의", nodeId: doc.nodes[1]?.id }],
      index,
    );
    expect(nodes).toHaveLength(doc.nodes.length);
    expect(edges).toHaveLength(doc.edges.length);
    const fault = nodes.find((n) => n.type === "inject_fault");
    expect(fault).toMatchObject({
      category: "fault",
      hasInput: true,
      outputs: [{ id: "next", label: "다음" }],
    });
    expect(fault?.summary).toMatch(/: 냉방기 정지$/);
    expect(nodes.find((n) => n.type === "start")?.hasInput).toBe(false);
    expect(nodes[1]?.warnings).toEqual(["주의"]);
    expect(nodes.find((n) => n.type === "agent_task")?.summary).toMatch(/^툴 \d+회, \d+분 안에$/);
  });

  test("blocks are added, wired, rewired, edited and removed — unusable ones say why", () => {
    let doc = emptyScenario("s", "sample");
    expect(() => sc.addBlock(doc, item("start"), { x: 0, y: 0 })).toThrow(
      "시작은 시나리오에 1개까지만 둘 수 있어요",
    );
    const planned = palette.find((p) => !p.available) as (typeof palette)[number];
    expect(() => sc.addBlock(doc, planned, { x: 0, y: 0 })).toThrow(planned.reason as string);
    const start = doc.nodes[0]?.id as string;
    const wait = sc.addBlock(doc, item("wait"), sc.freeSpot(doc));
    doc = wait.doc;
    expect(doc.nodes.at(-1)?.position).toEqual({ x: 0, y: 120 });
    const random = sc.addBlock(doc, item("random"), { x: 10.4, y: 300.6 });
    doc = random.doc;
    expect(doc.nodes.at(-1)?.position).toEqual({ x: 10, y: 301 });
    doc = sc.connect(doc, start, "next", wait.nodeId);
    doc = sc.connect(doc, wait.nodeId, "next", random.nodeId);
    doc = sc.connect(doc, wait.nodeId, "next", random.nodeId);
    expect(doc.edges.filter((e) => e.from === wait.nodeId)).toHaveLength(1);
    expect(() => sc.connect(doc, random.nodeId, "7", wait.nodeId)).toThrow(
      "'갈래 7' 출구가 없는 블록이에요",
    );
    expect(() => sc.connect(doc, wait.nodeId, "next", start)).toThrow(
      "시작으로는 들어갈 수 없어요",
    );
    expect(() => sc.connect(doc, wait.nodeId, "next", wait.nodeId)).toThrow("자기 자신");
    expect(() => sc.connect(doc, "nope", "next", wait.nodeId)).toThrow("없는 블록");
    doc = sc.setParam(doc, random.nodeId, "branches", 3);
    doc = sc.connect(doc, random.nodeId, "3", wait.nodeId);
    doc = sc.setParam(doc, random.nodeId, "branches", 2);
    expect(doc.edges.some((e) => e.from === random.nodeId && e.port === "3")).toBe(false);
    doc = sc.setParam(doc, wait.nodeId, "seconds", undefined);
    expect(doc.nodes.find((n) => n.id === wait.nodeId)?.params.seconds).toBeUndefined();
    expect(sc.setParam(doc, "nope", "x", 1)).toEqual(doc);
    doc = sc.setLabel(doc, wait.nodeId, "  잠깐 ");
    expect(sc.toFlow(doc).nodes.find((n) => n.id === wait.nodeId)?.title).toBe("잠깐");
    doc = sc.setLabel(doc, wait.nodeId, "");
    expect(doc.nodes.find((n) => n.id === wait.nodeId)?.label).toBeUndefined();
    doc = sc.moveNode(doc, wait.nodeId, { x: 5.5, y: 6.4 });
    expect(doc.nodes.find((n) => n.id === wait.nodeId)?.position).toEqual({ x: 6, y: 6 });
    const edge = doc.edges[0]?.id as string;
    expect(sc.disconnect(doc, edge).edges).toHaveLength(doc.edges.length - 1);
    doc = sc.removeNodes(doc, [wait.nodeId, start]);
    expect(doc.nodes.map((n) => n.type)).toEqual(["start", "random"]);
    expect(doc.edges.some((e) => e.to === wait.nodeId || e.from === wait.nodeId)).toBe(false);
    expect(sc.freeSpot(emptyScenario("s", "w", "x"))).toEqual({ x: 0, y: 120 });
  });

  test("every block's summary reads as a sentence", () => {
    const n = (type: string, params: Record<string, unknown>) =>
      sc.summaryOf({ id: "n", type, params: params as never, position: { x: 0, y: 0 } }, index);
    expect(n("wait", { seconds: 300 })).toBe("5분 기다려요");
    expect(n("wait_until", {})).toBe("조건을 정해 주세요");
    expect(n("branch", { condition: { kind: "diagnosis_submitted" } })).toMatch(/\?$/);
    expect(n("wait_until", { condition: { kind: "diagnosis_submitted" } })).toMatch(/까지$/);
    expect(n("random", { branches: 3 })).toBe("3갈래 중 하나");
    expect(n("note", { text: "메모" })).toBe("메모");
    expect(n("clear_fault", {})).toBe("복구할 고장을 골라 주세요");
    expect(n("clear_fault", { ref: "n2" })).toBe("n2 블록의 고장을 복구해요");
    expect(n("set_load", { target: "srv-a1", value: 0.9 })).toMatch(/부하 90%$/);
    expect(n("set_setpoint", { target: "crah-1", celsius: 16 })).toMatch(/16°C$/);
    expect(n("power", { target: "srv-a1", on: false })).toMatch(/꺼요$/);
    expect(n("power", { target: "srv-a1", on: true })).toMatch(/켜요$/);
    expect(n("inject_fault", { target: "x" })).toBe("x: 고장");
    expect(n("mystery", {})).toBe("");
  });
});

describe("the block inspector [REQ-034]", () => {
  test("fields come from the block's parameters, with this world's equipment to choose from", () => {
    const doc = template("cooling-failure");
    const fault = doc.nodes.find((n) => n.type === "inject_fault") as (typeof doc.nodes)[number];
    const fields = sc.fieldsOf(doc, fault.id, index);
    expect(fields.map((f) => f.name)).toEqual(["faultType", "target", "durationSeconds"]);
    const type = fields[0] as Extract<sc.Field, { control: "choice" }>;
    expect(type.choices.find((c) => c.value === "cooling_unit_failure")?.label).toBe("냉방기 정지");
    const target = fields[1] as Extract<sc.Field, { control: "choice" }>;
    expect(target.choices.map((c) => c.value).sort()).toEqual(["crah-1", "crah-2"]);
    expect(target.choices[0]?.group).toMatch(/의 냉방기$/);
    expect(fields[2]).toMatchObject({ control: "recovery", mode: "until_fixed" });
    expect(sc.fieldsOf(doc, "nope", index)).toEqual([]);
    const agent = doc.nodes.find((n) => n.type === "agent_task") as (typeof doc.nodes)[number];
    expect(sc.fieldsOf(doc, agent.id, index)[0]).toMatchObject({
      control: "text",
      multiline: true,
    });
  });

  test("other controls: toggles, conditions, references, fault details, links", () => {
    let doc = emptyScenario("s", "sample");
    for (const key of [
      "power",
      "branch",
      "clear_fault",
      "inject_fault:sensor_drift",
      "inject_fault:link_down",
      "set_load",
    ])
      doc = sc.addBlock(doc, item(key), { x: 0, y: 0 }).doc;
    const [, power, branch, clear, drift, link, load] = doc.nodes.map((n) => n.id) as string[];
    expect(sc.fieldsOf(doc, power as string, index)[1]).toMatchObject({
      control: "toggle",
      value: false,
    });
    expect(sc.fieldsOf(doc, branch as string, index)[0]).toMatchObject({
      control: "condition",
      value: undefined,
    });
    const ref = sc.fieldsOf(doc, clear as string, index)[0] as Extract<
      sc.Field,
      { control: "choice" }
    >;
    expect(ref.choices.map((c) => c.value)).toEqual([drift, link]);
    const details = sc.fieldsOf(doc, drift as string, index)[2] as Extract<
      sc.Field,
      { control: "numbers" }
    >;
    expect(details.items[0]).toMatchObject({ name: "deltaC", unit: "°C" });
    const links = sc.fieldsOf(doc, link as string, index)[1] as Extract<
      sc.Field,
      { control: "choice" }
    >;
    expect(links.choices.every((c) => c.group === "네트워크 링크" && c.label.includes(" → "))).toBe(
      true,
    );
    expect(sc.fieldsOf(doc, load as string, index)[1]).toMatchObject({
      control: "number",
      step: 0.05,
    });
    expect(sc.readNumber("", { min: 0, max: 10, step: 1 })).toBeUndefined();
    expect(sc.readNumber("x", { min: 0, max: 10, step: 1 })).toBeUndefined();
    expect(sc.readNumber("12", { min: 0, max: 10, step: 1 })).toBe(10);
    expect(sc.readNumber("2,5", { min: 0, max: 10, step: 0.5 })).toBe(2.5);
    expect(sc.readNumber("2.6", { min: 0, max: 10, step: 1 })).toBe(3);
  });

  test("conditions start from something sensible and offer the entity's own fields", () => {
    expect(sc.newCondition("state", index)).toMatchObject({
      kind: "state",
      entity: "rack-a",
      field: "inletC",
      op: ">",
    });
    for (const kind of Object.keys(
      sc.CONDITION_KIND_LABELS,
    ) as (keyof typeof sc.CONDITION_KIND_LABELS)[])
      expect(sc.newCondition(kind, index).kind).toBe(kind);
    expect(sc.stateFields(index, "rack-a").map((f) => f.value)).toContain("inletC");
    expect(sc.stateFields(index, "rack-a").find((f) => f.value === "inletC")?.label).toBe(
      "흡기 온도 (°C)",
    );
    expect(sc.stateFields(index, "nope")).toEqual([]);
    expect(sc.OP_LABELS[">="]).toBe("이상");
  });
});

describe("the scoring sheet [REQ-034]", () => {
  test("add, change and remove items; the total aims at 100", () => {
    let doc = emptyScenario("s", "sample");
    expect(sc.sheetTotal(doc)).toEqual({
      points: 0,
      note: "채점 항목이 없으면 점수가 나오지 않아요",
    });
    const kinds = Object.keys(sc.EXPECTATION_LABELS) as (keyof typeof sc.EXPECTATION_LABELS)[];
    for (const k of kinds) doc = sc.addExpectation(doc, k).doc;
    expect(doc.expectations.map((e) => e.id)).toEqual(["x1", "x2", "x3", "x4", "x5", "x6"]);
    expect(sc.sheetTotal(doc).points).toBe(110);
    doc = sc.updateExpectation(doc, "x1", { weight: 50, kind: "tool_budget" } as never);
    expect(doc.expectations[0]).toMatchObject({ kind: "diagnosis", weight: 50 });
    expect(sc.sheetTotal(doc)).toEqual({ points: 100 });
    expect(doc.expectations.map((e) => sc.expectationText(e))).toEqual([
      "원인 ? / 고장 ?",
      "어느 장비든 심각 알람이 없어요",
      "재시작",
      "전원 끄기 1회마다 −20점",
      "30분 안에",
      "20회 이하",
    ]);
    doc = sc.removeExpectation(doc, "x2");
    expect(sc.sheetTotal(doc).note).toBe(
      "합이 80점이에요. 100점이 아니어도 되지만, 100점이면 읽기 쉬워요",
    );
    const real = template("cooling-failure");
    expect(
      sc.expectationText(real.expectations.find((e) => e.kind === "diagnosis") as never),
    ).toMatch(/^원인 crah-/);
    expect(
      sc.expectationText({
        id: "a",
        kind: "required_action",
        action: "restart",
        target: "crah-1",
        weight: 1,
      }),
    ).toBe("재시작 (crah-1)");
  });
});

const parent: Experiment = {
  id: "e-1",
  name: "기준선",
  owner: "yeonsu",
  createdAt: "2026-10-29T00:00:00Z",
  recipe: {
    worldId: "w-1",
    scenarioId: "s-1",
    harnessId: "builtin",
    agentId: "triage",
    tools: normalizeTools(["get_impact", "list_alarms"]),
    seeds: [1, 2, 3],
    time: { kind: "lockstep", secondsPerCall: 30 },
    profiles: {},
  },
  snapshot: {
    worldDigest: "d",
    worldName: "홀",
    scenarioDigest: "s",
    scenarioName: "냉방",
    oracle: "1",
  },
  benchmarkKey: "k",
};

describe("the experiment form and forks [REQ-030] [REQ-040]", () => {
  test("a draft says what is missing step by step, and becomes a request", () => {
    let d = ex.emptyDraft();
    expect(ex.draftProblems(d)).toEqual({
      what: ["세계를 골라 주세요", "시나리오를 골라 주세요"],
      who: ["하네스를 골라 주세요"],
      how: [],
    });
    d = { ...d, worldId: "w-1", scenarioId: "s-1", harnessId: "builtin" };
    expect(ex.draftProblems(d).who).toEqual(["에이전트를 골라 주세요"]);
    d = { ...d, agentId: "chef" };
    expect(ex.draftProblems(d, ["triage"]).who).toEqual(["하네스에 'chef' 에이전트가 없어요"]);
    d = { ...d, agentId: "triage", runs: 25 };
    expect(ex.draftProblems(d, ["triage"]).how[0]).toBe("실행 횟수는 1~20번이에요");
    d = { ...d, runs: 3, profiles: { vcenter: "vcenter/5.5" } };
    expect(ex.draftProblems(d, ["triage"]).how.length).toBe(1);
    d = { ...d, profiles: {} };
    expect(ex.isReady(ex.draftProblems(d, ["triage"]))).toBe(true);
    const none = ex.toggleTool(
      ex.toggleTool({ ...ex.emptyDraft(), tools: ["list_alarms"] }, "list_alarms", false),
      "submit_diagnosis",
      false,
    );
    expect(ex.draftProblems(none).how).toEqual([
      "조사에 쓸 툴을 하나 이상 골라 주세요 (진단 제출은 늘 포함돼요)",
    ]);
    expect(ex.toggleTool(d, "wait", true).tools.filter((t) => t === "wait")).toHaveLength(1);
    const req = ex.toRequest({ ...d, note: "  메모 " }, ex.suggestedName("냉방", "triage"));
    expect(req).toMatchObject({
      name: "냉방, triage",
      note: "메모",
      recipe: { runs: 3, agentId: "triage" },
    });
    expect(req.recipe.tools).toContain("submit_diagnosis");
    expect(ex.suggestedName()).toBe("새 실험");
    expect(() => ex.toRequest(ex.emptyDraft(), "x")).toThrow("실험 조건이 다 정해지지 않았어요");
    expect(ex.toolGroups().map((g) => g.category)).toEqual([
      "observe",
      "protocol",
      "act",
      "answer",
    ]);
    expect(ex.PROFILE_CHOICES.vcenter).toContain("vcenter/8.0");
  });

  test("a fork starts as the original, shows what will differ, and sends only that", () => {
    let d = ex.draftFrom(parent);
    expect(d.name).toBe("기준선 (포크)");
    expect(ex.forkChanges(parent, d)).toEqual([]);
    d = { ...d, agentId: "guess" };
    expect(ex.forkChanges(parent, d)).toEqual([
      { field: "agentId", label: "에이전트", before: "triage", after: "guess" },
    ]);
    expect(ex.leavesBenchmarkSet(ex.forkChanges(parent, d))).toBe(false);
    expect(ex.toForkRequest(parent, d)).toEqual({ change: { agentId: "guess" } });
    const timed = {
      ...d,
      time: { kind: "lockstep" as const, secondsPerCall: 60 },
      name: "느린 시계",
      note: "시간",
    };
    expect(ex.leavesBenchmarkSet(ex.forkChanges(parent, timed))).toBe(true);
    expect(ex.toForkRequest(parent, timed)).toMatchObject({
      name: "느린 시계",
      note: "시간",
      change: { agentId: "guess" },
    });
    expect(ex.forkChanges(parent, ex.emptyDraft())).toEqual([]);
    expect(() => ex.toForkRequest(parent, ex.emptyDraft())).toThrow();
  });
});

describe("small charts [REQ-037]", () => {
  test("round ticks, a line fitted to its box, a score with its interval", () => {
    expect(niceTicks(0, 100, 4)).toEqual([0, 25, 50, 75, 100]);
    expect(niceTicks(18.2, 31.7, 3)).toEqual([20, 25, 30]);
    expect(niceTicks(5, 5)).toEqual([5]);
    expect(niceTicks(Number.NaN, 1)).toEqual([]);
    const chart = lineChart(
      [
        [0, 20],
        [60, 30],
      ],
      { w: 200, h: 100 },
    );
    expect(chart.path).toBe("M0.0 91.7L200.0 8.3");
    expect(chart.yOf(25)).toBeCloseTo(50);
    expect(chart.xTicks[0]?.value).toBe(0);
    const flat = lineChart([[0, 0]], { w: 10, h: 10 }, -5);
    expect(flat.domain.y[0]).toBeLessThan(-5);
    expect(lineChart([], { w: 10, h: 10 }).path).toBe("");
    expect(scoreBar(80, 10, 200)).toEqual({ x: 160, from: 140, to: 180 });
    expect(scoreBar(98, 10, 100).to).toBe(100);
  });
});
