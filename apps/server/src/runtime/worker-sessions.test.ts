import { InvalidValueError } from "@terrarium/core/kernel";
import { emptyScenario, SCENARIO_TEMPLATES } from "@terrarium/core/scenario";
import { DEFAULT_TOOLSET } from "@terrarium/core/tools";
import { BlueprintIndex } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { sampleBlueprint } from "../../../../packages/core/src/world/test-support/sample";
import type { FromWorker } from "./worker-protocol";
import { errorOf, WorkerSessions } from "./worker-sessions";

const blueprint = sampleBlueprint();
const scenario = SCENARIO_TEMPLATES[0]?.build(new BlueprintIndex(blueprint), "sample") as never;

describe("what a session worker answers [REQ-032]", () => {
  test("open, call, finish, dispose — and every failure becomes a message", async () => {
    const out: FromWorker[] = [];
    const w = new WorkerSessions((m) => out.push(m));
    await w.handle({
      kind: "open",
      id: "a",
      config: { blueprint, scenario, tools: DEFAULT_TOOLSET, seed: 1 },
    });
    expect(out[0]).toMatchObject({
      kind: "opened",
      id: "a",
      task: { maxToolCalls: expect.any(Number) },
    });
    await w.handle({ kind: "call", id: "a", seq: 1, tool: "list_alarms", args: {} });
    expect(out[1]).toMatchObject({ kind: "called", seq: 1, result: { ok: true } });
    await w.handle({ kind: "finish", id: "a", seq: 2 });
    expect(out[2]).toMatchObject({
      kind: "finished",
      seq: 2,
      result: { endReason: "agent_finished" },
    });
    await w.handle({ kind: "call", id: "zz", seq: 3, tool: "list_alarms", args: {} });
    expect(out[3]).toEqual({
      kind: "failed",
      id: "zz",
      seq: 3,
      error: { message: "세션 zz가 이 워커에 없다" },
    });
    await w.handle({
      kind: "open",
      id: "b",
      config: {
        blueprint,
        scenario: { ...emptyScenario("x", "sample"), nodes: [] },
        tools: [],
        seed: 1,
      },
    });
    expect(out[4]).toMatchObject({
      kind: "open_failed",
      id: "b",
      error: { code: "invalid_value" },
    });
    expect(w.size).toBe(1);
    await w.handle({ kind: "dispose", id: "a" });
    await w.handle({ kind: "dispose", id: "a" });
    expect(w.size).toBe(0);
  });

  test("errors keep their kind across the thread boundary", () => {
    expect(errorOf(new InvalidValueError("x"))).toEqual({ message: "x", code: "invalid_value" });
    expect(errorOf(new Error("y"))).toEqual({ message: "y" });
    expect(errorOf("z")).toEqual({ message: "z" });
  });
});
