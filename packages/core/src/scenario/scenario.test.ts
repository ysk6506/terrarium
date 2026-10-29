import { Catalog } from "@terrarium/core/catalog";
import { BlueprintIndex, ENTITY_KINDS, FAULT_SPECS, World } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { sampleBlueprint, withChanges } from "../world/test-support/sample";
import { campusBlueprint } from "../world/test-support/sample-campus";
import {
  BLOCK_SPECS,
  CONDITION_FIELDS,
  type Condition,
  compare,
  describeCondition,
  type Expectation,
  emptyScenario,
  evaluate,
  hasErrors,
  MAX_NODES,
  NO_AGENT,
  outputsOf,
  paletteFor,
  type ScenarioDoc,
  type ScenarioIssue,
  type ScenarioNode,
  scenarioDigest,
  validateScenario,
} from ".";

const catalog = new Catalog();
const index = new BlueprintIndex(sampleBlueprint());
const env = { index, catalog };

const node = (id: string, type: string, params: ScenarioNode["params"] = {}): ScenarioNode => ({
  id,
  type,
  params,
  position: { x: 0, y: 0 },
});

/** start → fault(crah-1) → agent, with a diagnosis expectation: valid, no warnings. */
function base(): ScenarioDoc {
  return {
    ...emptyScenario("s1", "sample"),
    nodes: [
      node("start", "start"),
      node("fault", "inject_fault", { faultType: "cooling_unit_failure", target: "crah-1" }),
      node("agent", "agent_task", { prompt: "홀 온도 알람을 조사하라" }),
    ],
    edges: [
      { id: "e1", from: "start", port: "next", to: "fault" },
      { id: "e2", from: "fault", port: "next", to: "agent" },
    ],
    expectations: [
      {
        id: "d",
        kind: "diagnosis",
        rootCause: ["crah-1"],
        faultType: ["cooling_unit_failure"],
        weight: 1,
      },
    ],
  };
}

const codes = (issues: readonly ScenarioIssue[]) => issues.map((i) => i.code);
const check = (doc: ScenarioDoc) => validateScenario(doc, env);
const withNode = (
  doc: ScenarioDoc,
  n: ScenarioNode,
  from = "agent",
  port = "next",
): ScenarioDoc => ({
  ...doc,
  nodes: [...doc.nodes, n],
  edges: [...doc.edges, { id: `e-${n.id}`, from, port, to: n.id }],
});
const issuesFor = (n: ScenarioNode) => check(withNode(base(), n));

describe("scenario blocks [REQ-034]", () => {
  test("every block explains itself in Korean, and planned blocks say why they are unavailable", () => {
    for (const spec of BLOCK_SPECS) {
      expect(spec.label).toMatch(/[가-힣]/);
      expect(spec.description).toMatch(/[가-힣]/);
      for (const param of spec.params) expect(param.label).toMatch(/[가-힣]/);
      if (spec.status === "planned") expect(spec.plannedReason?.length).toBeGreaterThan(20);
    }
    expect(BLOCK_SPECS.filter((b) => b.status === "planned").map((b) => b.type)).toEqual([
      "set_outdoor_temp",
      "network_degrade",
    ]);
  });

  test("every condition field exists in the simulated state with the declared type", () => {
    // The campus sample has every kind of entity, including plant, liquid cooling and land.
    const world = World.fromBlueprint(campusBlueprint(), catalog);
    const kindsSeen = new Set(world.index.all().map((e) => e.kind));
    expect(kindsSeen.size).toBe(ENTITY_KINDS.length);
    for (const entity of world.index.all()) {
      const state = world.stateOf(entity.id) as unknown as Record<string, unknown>;
      for (const [field, spec] of Object.entries(CONDITION_FIELDS[entity.kind])) {
        const expected = spec.type === "enum" ? "string" : spec.type;
        expect([entity.kind, field, typeof state[field]]).toEqual([entity.kind, field, expected]);
      }
    }
  });

  test("random blocks have one output per branch, clamped to 2..4", () => {
    expect(outputsOf(node("r", "random", { branches: 3 }))).toEqual(["1", "2", "3"]);
    expect(outputsOf(node("r", "random", { branches: 9 }))).toEqual(["1", "2", "3", "4"]);
    expect(outputsOf(node("r", "random"))).toEqual(["1", "2"]);
    expect(outputsOf(node("w", "wait_until"))).toEqual(["met", "timeout"]);
    expect(outputsOf(node("x", "nope"))).toEqual([]);
  });
});

describe("scenario palette [REQ-034]", () => {
  test("in the sample hall every supported fault can be used, each as its own block", () => {
    const palette = paletteFor(index);
    const faults = palette.filter((p) => p.type === "inject_fault");
    expect(faults.map((f) => f.params.faultType)).toEqual(FAULT_SPECS.map((f) => f.type));
    // The hall has no plant, CDU or generator, so exactly the faults that need those are disabled.
    const missing = faults.filter((f) => !f.available).map((f) => f.params.faultType);
    expect(missing).toEqual([
      "chiller_failure",
      "chiller_degraded",
      "cdu_failure",
      "cdu_pump_failure",
      "generator_start_failure",
    ]);
    // In the campus sample every supported fault has something to act on.
    const campus = paletteFor(new BlueprintIndex(campusBlueprint()));
    const campusFaults = campus.filter((p) => p.type === "inject_fault");
    expect(campusFaults.every((f) => f.available)).toBe(true);
    expect(palette.find((p) => p.key === "inject_fault:cooling_unit_failure")).toMatchObject({
      group: "설비",
      label: "냉방기 정지",
      candidates: 2,
      params: { faultType: "cooling_unit_failure", durationSeconds: 0 },
    });
    expect(palette.find((p) => p.key === "wait")).toMatchObject({
      available: true,
      params: { seconds: 300 },
    });
  });

  test("blocks the simulator does not support yet are shown disabled, with the reason", () => {
    const outdoor = paletteFor(index).find((p) => p.key === "set_outdoor_temp");
    expect(outdoor).toMatchObject({
      available: false,
      reason: expect.stringContaining("아직 시뮬레이터가 지원하지 않는다"),
    });
  });

  test("blocks with nothing to act on in this world are disabled, naming what is missing", () => {
    const noCooling = new BlueprintIndex(
      withChanges(sampleBlueprint(), { remove: ["crah-1", "crah-2"] }),
    );
    const palette = paletteFor(noCooling);
    expect(palette.find((p) => p.key === "inject_fault:cooling_unit_failure")).toMatchObject({
      available: false,
      candidates: 0,
      reason: "이 세계에는 대상으로 쓸 장비(냉방기)가 없다",
    });
    expect(palette.find((p) => p.key === "set_setpoint")?.available).toBe(false);
    expect(palette.find((p) => p.key === "inject_fault:fan_failure")?.available).toBe(true);
  });
});

describe("scenario validation [REQ-034]", () => {
  test("a well-formed scenario has no issues", () => {
    expect(check(base())).toEqual([]);
  });

  test("format version, size and duplicate ids", () => {
    expect(codes(check({ ...base(), schemaVersion: 99 }))).toEqual(["SC001"]);
    const many = Array.from({ length: MAX_NODES + 1 }, (_, i) => node(`n${i}`, "note"));
    expect(codes(check({ ...base(), nodes: many }))).toEqual(["SC020"]);
    const dup = { ...base(), nodes: [...base().nodes, node("fault", "note")] };
    expect(check(dup)).toContainEqual(expect.objectContaining({ code: "SC002", nodeId: "fault" }));
  });

  test("exactly one start and one agent task", () => {
    const noAgent = {
      ...base(),
      nodes: base().nodes.filter((n) => n.type !== "agent_task"),
      edges: base().edges.slice(0, 1),
    };
    expect(check(noAgent)).toContainEqual(
      expect.objectContaining({ code: "SC005", message: "「에이전트 투입」 블록이 필요하다" }),
    );
    const twoAgents = withNode(base(), node("agent2", "agent_task", { prompt: "x" }));
    expect(check(twoAgents)).toContainEqual(
      expect.objectContaining({ code: "SC005", message: expect.stringContaining("1개만") }),
    );
  });

  test("unknown and not-yet-supported blocks are refused with the reason", () => {
    expect(codes(issuesFor(node("x", "teleport")))).toEqual(["SC003"]);
    const [planned] = issuesFor(node("hot", "set_outdoor_temp", { celsius: 40 }));
    expect(planned).toMatchObject({
      code: "SC004",
      nodeId: "hot",
      message: expect.stringContaining("외기"),
    });
  });

  test("parameters are checked against the block and the world", () => {
    const issue = (n: ScenarioNode) => issuesFor(n)[0];
    expect(issue(node("w", "wait", { seconds: 0 }))).toMatchObject({
      code: "SC011",
      param: "seconds",
      message: "「대기」의 대기 시간: 1~86400 초 사이여야 한다 (지금 0)",
    });
    expect(issue(node("w", "wait", { seconds: 1.5 }))?.message).toContain("정수");
    expect(issue(node("w", "wait", { seconds: "10" }))?.message).toContain("숫자");
    expect(issue(node("p", "power", { target: "srv-a1", on: "yes" }))?.message).toContain(
      "예/아니오",
    );
    expect(issue(node("p", "power", {}))).toMatchObject({
      code: "SC011",
      message: "「전원 켜기/끄기」의 대상을 정해야 한다",
    });
    expect(issue(node("p", "power", { target: "ghost" }))).toMatchObject({
      code: "SC012",
      message: expect.stringContaining("이 세계에 'ghost'가 없다"),
    });
    expect(issue(node("p", "power", { target: "pdu-a" }))?.message).toContain(
      "서버·스위치·스토리지·냉방기·VM만",
    );
    const blank = {
      ...base(),
      nodes: base().nodes.map((n) =>
        n.type === "agent_task" ? { ...n, params: { prompt: "  " } } : n,
      ),
    };
    expect(check(blank)[0]?.message).toBe("「에이전트 투입」의 과제 설명: 비어 있다");
    expect(issue(node("n", "note", { text: "x".repeat(501) }))?.message).toContain("500자");
    expect(issuesFor(node("n", "note"))).toEqual([]);
  });

  test("faults must fit their target, and their settings their ranges", () => {
    const fault = (params: ScenarioNode["params"]) =>
      issuesFor(node("f2", "inject_fault", params))[0];
    expect(fault({ faultType: "breaker_trip", target: "crah-1" })).toMatchObject({
      code: "SC013",
      message: expect.stringContaining("분전반·PDU에만 줄 수 있다 (crah-1은 냉방기)"),
    });
    expect(
      fault({ faultType: "fan_failure", target: "srv-a1", faultParams: { fanIndex: 99 } })?.message,
    ).toContain("0~9");
    expect(
      fault({ faultType: "fan_failure", target: "srv-a1", faultParams: { rpm: 1 } })?.message,
    ).toContain("'rpm'");
    expect(fault({ faultType: "meteor", target: "srv-a1" })?.message).toContain(
      "알 수 없는 장애 종류",
    );
    const link = index.allLinks().find((l) => l.kind === "network")?.id as string;
    expect(fault({ faultType: "link_down", target: link })).toBeUndefined();
    expect(fault({ faultType: "fan_failure", target: link })?.message).toContain(
      "링크에 줄 수 없다",
    );
  });

  test("setpoints are checked against the cooling unit's model", () => {
    const [issue] = issuesFor(node("sp", "set_setpoint", { target: "crah-1", celsius: 30 }));
    expect(issue).toMatchObject({
      code: "SC011",
      param: "celsius",
      message: expect.stringMatching(/16~27 °C/),
    });
    expect(issuesFor(node("sp", "set_setpoint", { target: "crah-1", celsius: 20 }))).toEqual([]);
  });

  test("conditions must name real fields, comparable values and known tools", () => {
    const cond = (condition: unknown) =>
      issuesFor(node("b", "branch", { condition: condition as Condition }))[0];
    expect(
      cond({ kind: "state", entity: "srv-a1", field: "inletC", op: ">", value: 30 }),
    ).toBeUndefined();
    expect(
      cond({ kind: "state", entity: "srv-a1", field: "temp", op: ">", value: 30 })?.message,
    ).toContain("가능: 상태, 전원 공급");
    expect(
      cond({ kind: "state", entity: "srv-a1", field: "powered", op: ">", value: true })?.message,
    ).toContain("같다/다르다로만");
    expect(
      cond({ kind: "state", entity: "srv-a1", field: "health", op: "==", value: "fine" })?.message,
    ).toContain("'fine'");
    expect(
      cond({ kind: "state", entity: "srv-a1", field: "inletC", op: "~", value: 1 })?.message,
    ).toContain("'~'");
    expect(cond({ kind: "tool_called", tool: "hack" })?.message).toContain("'hack'");
    expect(cond({ kind: "alarm", active: true, entity: "ghost" })?.code).toBe("SC012");
    expect(cond({ kind: "any", of: [] })?.message).toContain("비었다");
    const deep: Condition = {
      kind: "all",
      of: [
        {
          kind: "any",
          of: [{ kind: "all", of: [{ kind: "all", of: [{ kind: "diagnosis_submitted" }] }] }],
        },
      ],
    };
    expect(cond(deep)?.message).toContain("3단계");
    expect(cond({ kind: "weather" })?.message).toContain("'weather'");
    expect(cond(undefined)?.message).toContain("정해야 한다");
  });

  test("clear-fault blocks must point at an inject-fault block", () => {
    expect(issuesFor(node("c", "clear_fault", { ref: "fault" }))).toEqual([]);
    expect(issuesFor(node("c", "clear_fault", { ref: "agent" }))[0]).toMatchObject({
      code: "SC015",
    });
  });

  test("edges must use real outputs and may not form loops", () => {
    const edge = (from: string, port: string, to: string) =>
      check({ ...base(), edges: [...base().edges, { id: "x", from, port, to }] });
    expect(edge("fault", "yes", "agent")[0]).toMatchObject({
      code: "SC007",
      edgeId: "x",
      message: expect.stringContaining("'yes' 출구가 없다"),
    });
    expect(edge("agent", "next", "start")[0]?.message).toContain("들어오는 연결은 둘 수 없다");
    expect(edge("agent", "next", "ghost")[0]?.message).toContain("없는 블록");
    expect(edge("agent", "next", "fault").map((i) => i.code)).toContain("SC008");
    expect(edge("agent", "next", "agent")[0]?.code).toBe("SC008");
  });

  test("unreachable blocks are flagged; an unreachable agent task is an error", () => {
    const stray = {
      ...base(),
      nodes: [
        ...base().nodes,
        node("w", "wait", { seconds: 5 }),
        node("memo", "note", { text: "설명" }),
      ],
    };
    expect(check(stray)).toEqual([
      expect.objectContaining({ code: "SC009", severity: "warning", nodeId: "w" }),
    ]);
    const cut = { ...base(), edges: base().edges.slice(0, 1) };
    expect(check(cut)).toEqual([
      expect.objectContaining({ code: "SC010", severity: "error", nodeId: "agent" }),
    ]);
    expect(hasErrors(check(cut))).toBe(true);
    expect(hasErrors(check(stray))).toBe(false);
  });

  test("a block reached from two parallel paths is flagged as running twice", () => {
    const doc = base();
    const forked: ScenarioDoc = {
      ...doc,
      nodes: [
        ...doc.nodes,
        node("a", "wait", { seconds: 5 }),
        node("b", "wait", { seconds: 9 }),
        node("join", "power", { target: "srv-a1", on: false }),
      ],
      edges: [
        ...doc.edges,
        { id: "f1", from: "agent", port: "next", to: "a" },
        { id: "f2", from: "agent", port: "next", to: "b" },
        { id: "j1", from: "a", port: "next", to: "join" },
        { id: "j2", from: "b", port: "next", to: "join" },
      ],
    };
    expect(check(forked)).toEqual([expect.objectContaining({ code: "SC019", nodeId: "join" })]);
    // An exclusive branch that merges again is fine.
    const branch: ScenarioDoc = {
      ...forked,
      nodes: [
        ...forked.nodes,
        node("br", "branch", { condition: { kind: "diagnosis_submitted" } }),
      ],
      edges: [
        ...doc.edges,
        { id: "f0", from: "agent", port: "next", to: "br" },
        { id: "f1", from: "br", port: "yes", to: "a" },
        { id: "f2", from: "br", port: "no", to: "b" },
        { id: "j1", from: "a", port: "next", to: "join" },
        { id: "j2", from: "b", port: "next", to: "join" },
      ],
    };
    expect(check(branch)).toEqual([]);
  });

  test("expectations are checked, and missing or inconsistent scoring is pointed out", () => {
    const withExpectation = (e: Expectation) =>
      check({ ...base(), expectations: [...base().expectations, e] });
    expect(
      withExpectation({ id: "x", kind: "required_action", action: "fly" as never, weight: 1 })[0],
    ).toMatchObject({
      code: "SC016",
      expectationId: "x",
      message: expect.stringContaining("'fly'"),
    });
    expect(
      withExpectation({
        id: "x",
        kind: "forbidden_action",
        action: "power_off",
        target: "ghost",
        penalty: 5,
      })[0]?.code,
    ).toBe("SC012");
    expect(
      withExpectation({ id: "x", kind: "time_limit", seconds: 0, weight: 1 })[0]?.message,
    ).toContain("제한 시간은 0보다");
    expect(
      withExpectation({ id: "x", kind: "tool_budget", maxCalls: 10, weight: -1 })[0]?.message,
    ).toContain("배점");
    expect(
      withExpectation({
        id: "x",
        kind: "final_state",
        condition: { kind: "state", entity: "srv-a1", field: "x", op: "==", value: 1 },
        weight: 1,
      })[0]?.code,
    ).toBe("SC014");
    expect(
      withExpectation({
        id: "x",
        kind: "diagnosis",
        rootCause: [],
        faultType: ["fan_failure"],
        weight: 1,
      })[0]?.message,
    ).toContain("하나 이상");
    expect(
      withExpectation({
        id: "x",
        kind: "diagnosis",
        rootCause: ["ghost"],
        faultType: ["fan_failure"],
        weight: 1,
      })[0]?.code,
    ).toBe("SC012");
    expect(
      withExpectation({
        id: "x",
        kind: "diagnosis",
        rootCause: ["srv-a1"],
        faultType: ["meteor"],
        weight: 1,
      })[0]?.code,
    ).toBe("SC016");
    const wrongAnswer = check({
      ...base(),
      expectations: [
        {
          id: "d",
          kind: "diagnosis",
          rootCause: ["srv-a1"],
          faultType: ["fan_failure"],
          weight: 1,
        },
      ],
    });
    expect(wrongAnswer).toEqual([expect.objectContaining({ code: "SC021", severity: "warning" })]);
    expect(check({ ...base(), expectations: [] })).toEqual([
      expect.objectContaining({
        code: "SC017",
        message: expect.stringContaining("점수가 나오지 않는다"),
      }),
    ]);
    expect(
      check({
        ...base(),
        expectations: [{ id: "b", kind: "tool_budget", maxCalls: 5, weight: 1 }],
      }),
    ).toEqual([
      expect.objectContaining({
        code: "SC017",
        message: expect.stringContaining("진단은 채점하지 않는다"),
      }),
    ]);
  });
});

describe("scenario digest [REQ-039]", () => {
  test("layout and captions do not change the digest; behaviour and scoring do", () => {
    const doc = base();
    const moved: ScenarioDoc = {
      ...doc,
      name: "다른 이름",
      description: "설명",
      nodes: doc.nodes
        .map((n, i) => ({ ...n, position: { x: i * 99, y: 7 }, label: `블록 ${i}` }))
        .reverse(),
      edges: [...doc.edges].reverse().map((e) => ({ ...e, id: `${e.id}-renamed` })),
      expectations: doc.expectations.map((e) => ({ ...e, label: "정답" })),
    };
    expect(scenarioDigest(moved)).toBe(scenarioDigest(doc));
    const changed = {
      ...doc,
      nodes: doc.nodes.map((n) =>
        n.id === "agent" ? { ...n, params: { prompt: "다른 과제" } } : n,
      ),
    };
    expect(scenarioDigest(changed)).not.toBe(scenarioDigest(doc));
    const rescored = {
      ...doc,
      expectations: [{ ...(doc.expectations[0] as Expectation), weight: 2 } as Expectation],
    };
    expect(scenarioDigest(rescored)).not.toBe(scenarioDigest(doc));
    expect(scenarioDigest(doc)).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("condition sentences [REQ-034] [REQ-037]", () => {
  test("conditions read as Korean sentences with units", () => {
    expect(
      describeCondition(
        { kind: "state", entity: "srv-a1", field: "inletC", op: ">=", value: 35 },
        index,
      ),
    ).toBe("srv-a1 흡기 온도 ≥ 35 °C");
    expect(
      describeCondition(
        { kind: "state", entity: "srv-a1", field: "cpuUtil", op: "<", value: 0.5 },
        index,
      ),
    ).toBe("srv-a1 CPU 사용률 < 50%");
    expect(
      describeCondition(
        { kind: "state", entity: "srv-a1", field: "powered", op: "==", value: true },
        index,
      ),
    ).toBe("srv-a1 전원 공급 = 예");
    expect(
      describeCondition(
        { kind: "state", entity: "stor-b", field: "usedPct", op: ">", value: 90 },
        index,
      ),
    ).toBe("stor-b 사용량 > 90%");
    expect(
      describeCondition(
        { kind: "alarm", active: false, entity: "crah-1", severity: "critical" },
        index,
      ),
    ).toBe("crah-1 심각 알람이 없다");
    expect(describeCondition({ kind: "alarm", active: true, code: "fan_failed" })).toBe(
      "어느 장비든 'fan_failed' 알람이 있다",
    );
    expect(
      describeCondition({ kind: "tool_called", tool: "reset_breaker", target: "pdu-a" }, index),
    ).toBe("에이전트가 reset_breaker(pdu-a)를 호출했다");
    expect(
      describeCondition({
        kind: "any",
        of: [
          { kind: "diagnosis_submitted" },
          { kind: "state", entity: "x", field: "f", op: "!=", value: false },
        ],
      }),
    ).toBe("에이전트가 진단을 제출했다 또는 x f ≠ 아니오");
    expect(
      describeCondition({
        kind: "all",
        of: [{ kind: "diagnosis_submitted" }, { kind: "alarm", active: true, severity: "warning" }],
      }),
    ).toBe("에이전트가 진단을 제출했다 그리고 어느 장비든 경고 알람이 있다");
  });
});

describe("scenario validation edge cases [REQ-034]", () => {
  test("values of the wrong shape are named, not crashed on", () => {
    const first = (n: ScenarioNode) => issuesFor(n)[0]?.message;
    expect(first(node("p", "power", { target: 5 }))).toContain("이 세계에 '5'가 없다");
    expect(first(node("n", "note", { text: 5 }))).toContain("글이어야 한다");
    expect(
      first(node("f", "inject_fault", { faultType: "fan_failure", target: "ghost" })),
    ).toContain("'ghost'가 없다");
    expect(first(node("f", "inject_fault", { faultType: "fan_failure", target: 3 }))).toContain(
      "'3'가 없다",
    );
    expect(
      first(
        node("f", "inject_fault", { faultType: "fan_failure", target: "srv-a1", faultParams: 5 }),
      ),
    ).toContain("세부값 목록");
    expect(
      issuesFor(
        node("f", "inject_fault", { faultType: "meteor", target: "srv-a1", faultParams: { x: 1 } }),
      ).map((i) => i.param),
    ).toEqual(["faultType"]);
    expect(first(node("b", "branch", { condition: 5 as never }))).toContain("조건이 비었다");
    expect(
      first(
        node("b", "branch", {
          condition: { kind: "state", entity: "ghost", field: "x", op: "==", value: 1 },
        }),
      ),
    ).toContain("'ghost'가 없다");
    expect(issuesFor(node("b", "branch", { condition: { kind: "alarm", active: true } }))).toEqual(
      [],
    );
    const odd = { id: "x", kind: "bonus", weight: 1 } as unknown as Expectation;
    expect(check({ ...base(), expectations: [...base().expectations, odd] })[0]?.message).toContain(
      "'bonus'",
    );
  });

  test("a planned fault type is shown disabled in the palette and refused by validation", () => {
    const planned = {
      ...(FAULT_SPECS.find((f) => f.type === "fan_failure") as (typeof FAULT_SPECS)[number]),
      status: "planned" as const,
    };
    const faults = FAULT_SPECS.map((f) => (f.type === "fan_failure" ? planned : f));
    expect(
      paletteFor(index, faults).find((p) => p.key === "inject_fault:fan_failure"),
    ).toMatchObject({
      available: false,
      reason: expect.stringContaining("아직 시뮬레이터가"),
    });
    const issues = validateScenario(
      withNode(base(), node("f", "inject_fault", { faultType: "fan_failure", target: "srv-a1" })),
      { index, catalog, faults },
    );
    expect(issues).toEqual([
      expect.objectContaining({
        code: "SC004",
        message: expect.stringContaining("팬 고장은 아직"),
      }),
    ]);
  });

  test("comparisons follow the operator; ordering a non-number is false", () => {
    expect([
      compare("<", 1, 2),
      compare("<=", 2, 2),
      compare(">", 3, 2),
      compare(">=", 1, 2),
    ]).toEqual([true, true, true, false]);
    expect([compare("==", "ok", "ok"), compare("!=", true, false), compare("<", "a", 1)]).toEqual([
      true,
      true,
      false,
    ]);
  });

  test("more condition sentences", () => {
    expect(
      describeCondition(
        { kind: "state", entity: "srv-a1", field: "health", op: "!=", value: "ok" },
        index,
      ),
    ).toBe("srv-a1 상태 ≠ ok");
    expect(describeCondition({ kind: "tool_called", tool: "wait" })).toBe(
      "에이전트가 wait를 호출했다",
    );
    expect(
      evaluate(
        { kind: "tool_called", tool: "wait" },
        World.fromBlueprint(sampleBlueprint(), catalog),
        NO_AGENT,
      ),
    ).toBe(false);
  });
});
