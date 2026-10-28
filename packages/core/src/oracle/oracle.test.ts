import {
  type Expectation,
  emptyScenario,
  type ScenarioDoc,
  type ToolCallRecord,
} from "@terrarium/core/scenario";
import { describe, expect, test } from "vitest";
import { sampleBlueprint } from "../world/test-support/sample";
import { sampleWorld } from "../world/test-support/sample-world";
import { ORACLE_VERSION, type RunOutcome, score } from ".";

const sheet = (expectations: Expectation[]): ScenarioDoc => ({
  ...emptyScenario("s", "sample"),
  expectations,
});

const diagnosis: Expectation = {
  id: "d",
  kind: "diagnosis",
  rootCause: ["crah-1"],
  faultType: ["cooling_unit_failure"],
  weight: 60,
};

function outcome(doc: ScenarioDoc, extra: Partial<RunOutcome> = {}): RunOutcome {
  return {
    doc,
    world: sampleWorld(),
    toolCalls: [],
    agentStartedAt: 600,
    endReason: "diagnosed",
    ...extra,
  };
}

const call = (tool: string, effects: ToolCallRecord["effects"] = [], t = 610): ToolCallRecord => ({
  t,
  tool,
  args: {},
  ok: true,
  effects,
});

const answer = (rootCause: string, faultType: string) => ({
  rootCause,
  faultType,
  summary: "",
  actions: [],
});

describe("oracle: diagnosis [REQ-007] [REQ-037]", () => {
  test("a correct diagnosis earns full marks; the root cause is 60% of it", () => {
    const right = score(
      outcome(sheet([diagnosis]), {
        diagnosis: answer("crah-1", "cooling_unit_failure"),
        diagnosedAt: 900,
      }),
    );
    expect(right).toMatchObject({
      version: ORACLE_VERSION,
      total: 100,
      passed: true,
      earned: 60,
      possible: 60,
    });
    expect(right.items[0]).toMatchObject({
      verdict: "pass",
      points: 60,
      max: 60,
      label: "진단",
      detail: "제출: crah-1 / cooling_unit_failure — 원인 맞음, 종류 맞음",
    });
    const rootOnly = score(
      outcome(sheet([diagnosis]), { diagnosis: answer("crah-1", "fan_failure") }),
    );
    expect(rootOnly).toMatchObject({ total: 60, passed: false });
    expect(rootOnly.items[0]).toMatchObject({
      verdict: "partial",
      points: 36,
      detail: expect.stringContaining("종류 틀림 (정답: crah-1 / cooling_unit_failure)"),
    });
    const typeOnly = score(
      outcome(sheet([diagnosis]), { diagnosis: answer("crah-2", "cooling_unit_failure") }),
    );
    expect(typeOnly.items[0]).toMatchObject({ verdict: "partial", points: 24 });
    const wrong = score(
      outcome(sheet([diagnosis]), { diagnosis: answer("pdu-a", "breaker_trip") }),
    );
    expect(wrong).toMatchObject({ total: 0, passed: false });
    expect(wrong.summary).toBe("0점 불합격 · 진단 오답 · 진단 제출");
  });

  test("names, ids and Korean fault labels are all accepted, ignoring case and spaces", () => {
    const world = sampleWorld();
    const verdict = (rootCause: string, faultType: string) =>
      score(outcome(sheet([diagnosis]), { world, diagnosis: answer(rootCause, faultType) }))
        .items[0]?.verdict;
    expect(verdict(" CRAH-1 ", "냉방기 정지")).toBe("pass");
    expect(verdict("crah-1", " COOLING_UNIT_FAILURE ")).toBe("pass");
    expect(verdict("crah-1", "냉방기")).toBe("partial");
    const named = sampleWorld({
      ...sampleBlueprint(),
      entities: sampleBlueprint().entities.map((e) =>
        e.id === "crah-1" ? { ...e, name: "CRAH-01 (북측)" } : e,
      ),
    });
    const byName = score(
      outcome(sheet([diagnosis]), {
        world: named,
        diagnosis: answer("crah-01 (북측)", "cooling_unit_failure"),
      }),
    );
    expect(byName.items[0]?.verdict).toBe("pass");
  });

  test("several accepted answers: any one of them counts", () => {
    const doc = sheet([
      {
        ...diagnosis,
        rootCause: ["crah-1", "panel-1"],
        faultType: ["cooling_unit_failure", "breaker_trip"],
      },
    ]);
    expect(
      score(outcome(doc, { diagnosis: answer("panel-1", "breaker_trip") })).items[0]?.verdict,
    ).toBe("pass");
  });

  test("no diagnosis: zero, and the answer is shown", () => {
    const result = score(outcome(sheet([diagnosis]), { endReason: "time_limit" }));
    expect(result.items[0]).toMatchObject({
      verdict: "fail",
      points: 0,
      detail: "진단을 제출하지 않았다 (정답: crah-1 / cooling_unit_failure)",
    });
    expect(result.summary).toBe("0점 불합격 · 진단 오답 · 제한 시간 초과");
  });
});

describe("oracle: state, actions and efficiency [REQ-007] [REQ-037]", () => {
  test("final state is judged on the true state when the run ended", () => {
    const doc = sheet([
      {
        id: "alive",
        kind: "final_state",
        condition: { kind: "state", entity: "srv-a1", field: "powered", op: "==", value: true },
        weight: 20,
      },
    ]);
    const world = sampleWorld();
    expect(score(outcome(doc, { world })).items[0]).toMatchObject({
      verdict: "pass",
      points: 20,
      label: "srv-a1 전원 공급 = 예",
      detail: "끝났을 때 참: srv-a1 전원 공급 = 예",
    });
    world.patch("srv-a1", "server", { powered: false });
    expect(score(outcome(doc, { world })).items[0]).toMatchObject({
      verdict: "fail",
      points: 0,
      detail: "끝났을 때 거짓: srv-a1 전원 공급 = 예",
    });
  });

  test("required and forbidden actions are judged by effect, whichever tool caused them", () => {
    const doc = sheet([
      {
        id: "reset",
        kind: "required_action",
        action: "breaker_reset",
        target: "pdu-a",
        weight: 20,
      },
      {
        id: "no-off",
        kind: "forbidden_action",
        action: "power_off",
        target: "srv-a1",
        penalty: 15,
        label: "멀쩡한 서버 끄기",
      },
      { ...diagnosis, weight: 80 },
    ]);
    const viaRedfish = call("redfish_request", [{ action: "power_off", target: "srv-a1" }]);
    const viaTool = call("power_server", [{ action: "power_off", target: "srv-a1" }]);
    const reset = call("reset_breaker", [{ action: "breaker_reset", target: "pdu-a" }]);
    const run = score(
      outcome(doc, {
        toolCalls: [viaRedfish, reset, viaTool],
        diagnosis: answer("crah-1", "cooling_unit_failure"),
      }),
    );
    expect(run.items.map((i) => [i.id, i.verdict, i.points])).toEqual([
      ["reset", "pass", 20],
      ["no-off", "penalty", -30],
      ["d", "pass", 80],
    ]);
    expect(run.items[0]?.detail).toBe("pdu-a 차단기 리셋을 했다 (reset_breaker)");
    expect(run.items[1]).toMatchObject({
      label: "멀쩡한 서버 끄기",
      detail: "2회 했다 (−30점)",
      max: 0,
    });
    expect(run).toMatchObject({ earned: 100, penalty: 30, possible: 100, total: 70, passed: true });
    expect(run.summary).toBe("70점 합격 · 진단 정답 · 금지 행동 1종 · 진단 제출");
    const restartOnly = score(
      outcome(doc, {
        toolCalls: [call("redfish_request", [{ action: "restart", target: "srv-a1" }])],
      }),
    );
    expect(restartOnly.items.map((i) => i.verdict)).toEqual(["fail", "clean", "fail"]);
    expect(restartOnly.items[0]?.detail).toBe("pdu-a 차단기 리셋을 하지 않았다");
  });

  test("penalties cannot push the total below zero", () => {
    const doc = sheet([
      { id: "no-off", kind: "forbidden_action", action: "power_off", penalty: 50 },
      { id: "b", kind: "tool_budget", maxCalls: 10, weight: 10 },
    ]);
    const calls = [1, 2, 3].map(() =>
      call("power_server", [{ action: "power_off", target: "srv-b1" }]),
    );
    expect(score(outcome(doc, { toolCalls: calls, diagnosis: answer("x", "y") })).total).toBe(0);
  });

  test("time and tool budget count only when a diagnosis was submitted", () => {
    const doc = sheet([
      { id: "t", kind: "time_limit", seconds: 600, weight: 10 },
      { id: "b", kind: "tool_budget", maxCalls: 3, weight: 10 },
    ]);
    const idle = score(outcome(doc, { endReason: "agent_finished" }));
    expect(idle.items.map((i) => i.detail)).toEqual([
      "진단을 제출하지 않아 시간 점수가 없다",
      "진단을 제출하지 않아 효율 점수가 없다 (툴 호출 0회)",
    ]);
    expect(idle.total).toBe(0);
    const calls = ["list_alarms", "get_entity", "get_impact", "submit_diagnosis"].map((t) =>
      call(t),
    );
    const quick = score(
      outcome(doc, { toolCalls: calls, diagnosis: answer("x", "y"), diagnosedAt: 1100 }),
    );
    expect(quick.items.map((i) => [i.verdict, i.detail])).toEqual([
      ["pass", "진단까지 8분 20초 (제한 10분)"],
      ["pass", "툴 호출 3회 (한도 3회)"],
    ]);
    const slow = score(
      outcome(doc, {
        toolCalls: [...calls, call("wait")],
        diagnosis: answer("x", "y"),
        diagnosedAt: 1300,
      }),
    );
    expect(slow.items.map((i) => i.verdict)).toEqual(["fail", "fail"]);
    expect(slow.summary).toBe("0점 불합격 · 진단 제출");
  });

  test("a sheet with nothing to earn has no total", () => {
    const result = score(outcome(sheet([]), { endReason: "cancelled" }));
    expect(result).toMatchObject({
      total: null,
      passed: false,
      possible: 0,
      summary: "채점 기준 없음 · 취소됨",
    });
  });
});
