import { Catalog } from "@terrarium/core/catalog";
import { BlueprintIndex } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { sampleBlueprint } from "../world/test-support/sample";
import {
  actionsOf,
  agentActions,
  type Condition,
  describeCondition,
  emptyScenario,
  evaluate,
  type ScenarioDoc,
  type ToolCallRecord,
  validateScenario,
} from ".";

describe("agent actions [REQ-007] [REQ-039]", () => {
  test("world commands from one tool call become actions; off-then-on is a restart", () => {
    expect(
      actionsOf([
        { type: "power.set", target: "srv-a1", on: false },
        { type: "breaker.reset", target: "pdu-a" },
        { type: "power.set", target: "srv-a1", on: true },
        { type: "power.set", target: "srv-b1", on: false },
        { type: "power.set", target: "vm-web", on: true },
        { type: "setpoint.set", target: "crah-1", celsius: 18 },
        { type: "note", text: "NMI" },
      ]),
    ).toEqual([
      { action: "restart", target: "srv-a1" },
      { action: "breaker_reset", target: "pdu-a" },
      { action: "power_off", target: "srv-b1" },
      { action: "power_on", target: "vm-web" },
      { action: "setpoint_change", target: "crah-1" },
    ]);
  });

  test("conditions can ask what the agent did, whatever tool it used", () => {
    const calls: ToolCallRecord[] = [
      { t: 1, tool: "list_alarms", args: {}, ok: true },
      {
        t: 2,
        tool: "redfish_request",
        args: {},
        ok: true,
        effects: [{ action: "power_off", target: "srv-a1" }],
      },
    ];
    const agent = { toolCalls: () => calls, diagnosis: () => undefined };
    const world = { stateOf: () => ({}) as never, alarms: () => [] };
    expect(agentActions(calls)).toEqual([{ action: "power_off", target: "srv-a1" }]);
    expect(evaluate({ kind: "action_taken", action: "power_off" }, world, agent)).toBe(true);
    expect(
      evaluate({ kind: "action_taken", action: "power_off", target: "srv-b1" }, world, agent),
    ).toBe(false);
    expect(evaluate({ kind: "action_taken", action: "restart" }, world, agent)).toBe(false);
    expect(describeCondition({ kind: "action_taken", action: "power_off", target: "srv-a1" })).toBe(
      "에이전트가 srv-a1 전원 끄기를 했어요",
    );
    expect(describeCondition({ kind: "action_taken", action: "breaker_reset" })).toBe(
      "에이전트가 차단기 리셋을 했어요",
    );
  });
});

describe("validating action conditions [REQ-034]", () => {
  test("action conditions must name a known action and a real target", () => {
    const index = new BlueprintIndex(sampleBlueprint());
    const doc = (condition: Condition): ScenarioDoc => ({
      ...emptyScenario("a", "sample"),
      nodes: [
        { id: "start", type: "start", params: {}, position: { x: 0, y: 0 } },
        { id: "b", type: "branch", params: { condition }, position: { x: 0, y: 0 } },
        { id: "agent", type: "agent_task", params: { prompt: "x" }, position: { x: 0, y: 0 } },
      ],
      edges: [
        { id: "e1", from: "start", port: "next", to: "agent" },
        { id: "e2", from: "agent", port: "next", to: "b" },
      ],
      expectations: [{ id: "budget", kind: "tool_budget", maxCalls: 5, weight: 1 }],
    });
    const issues = (c: Condition) =>
      validateScenario(doc(c), { index, catalog: new Catalog() }).filter(
        (i) => i.severity === "error",
      );
    expect(issues({ kind: "action_taken", action: "power_off", target: "srv-a1" })).toEqual([]);
    expect(issues({ kind: "action_taken", action: "explode" as never })[0]?.message).toContain(
      "알 수 없는 행동 'explode' (가능: 전원 끄기, 전원 켜기, 재시작, 차단기 리셋, 냉방 설정 변경, 포트 끄기, 포트 켜기, 콘센트 끄기, 콘센트 켜기, 스위치 설정 변경, 펌웨어 올리기, 서비스를 대기 쪽으로 옮기기, 서비스 다시 시작, 프로세스 다시 시작, 디스크 비우기, 파일시스템 다시 마운트, VM 다른 서버로 옮기기)",
    );
    expect(issues({ kind: "action_taken", action: "restart", target: "ghost" })[0]?.code).toBe(
      "SC012",
    );
  });
});
