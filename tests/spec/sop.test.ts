/**
 * Runbooks as an experiment variable (REQ-082, ADR-0087 item 6): not given, given in the task, or found with
 * `search_runbooks`; compliance is read apart from the score; a draft comes from the best run's calls.
 */
import { ALL_SCENARIO_TEMPLATES, draftFromCalls, scoreSop } from "@terrarium/core/scenario";
import { Session, type SopMode } from "@terrarium/core/session";
import { DEFAULT_TOOLSET, type Runbook, runbookPrompt } from "@terrarium/core/tools";
import { BlueprintIndex } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { sampleBlueprint } from "../../packages/core/src/world/test-support/sample";

const BOOK: Runbook = {
  title: "냉방기 정지 절차",
  steps: [
    { id: "s1", todo: "알람 확인", check: "", tools: ["list_alarms"] },
    {
      id: "s2",
      todo: "냉방 설정 낮추기",
      check: "방 온도",
      tools: ["set_cooling_setpoint", "bacnet_request"],
    },
    { id: "s3", todo: "상태 다시 보기", check: "", tools: ["facility_status"] },
    { id: "s4", todo: "담당자와 상의", check: "", tools: [] },
  ],
};

const call = (tool: string, ok = true) => ({ tool, ok });

describe("how closely the calls followed the runbook [REQ-082]", () => {
  test("a step is done when one of its tools was called, and the steps in order are counted", () => {
    const r = scoreSop(BOOK, [
      call("list_alarms"),
      call("bacnet_request"),
      call("facility_status"),
    ]);
    expect(r.steps.map((s) => [s.id, s.done, s.inOrder])).toEqual([
      ["s1", true, true],
      ["s2", true, true],
      ["s3", true, true],
      ["s4", false, false],
    ]);
    // a step that names no tool is a thought: it is not counted
    expect(r).toMatchObject({
      scored: 3,
      done: 3,
      inOrder: 3,
      skipped: [],
      donePct: 100,
      orderPct: 100,
      compliancePct: 100,
    });
  });

  test("a step never done is skipped, and skipping costs the share", () => {
    const r = scoreSop(BOOK, [call("list_alarms"), call("facility_status")]);
    expect(r).toMatchObject({
      done: 2,
      skipped: ["s2"],
      donePct: 67,
      orderPct: 100,
      compliancePct: 67,
    });
  });

  test("doing a later step before an earlier one is out of order", () => {
    const r = scoreSop(BOOK, [
      call("facility_status"),
      call("list_alarms"),
      call("set_cooling_setpoint"),
    ]);
    expect(r.steps.map((s) => s.inOrder)).toEqual([true, true, false, false]);
    expect(r.done).toBe(3);
    expect(r.orderPct).toBeLessThan(100);
    expect(r.compliancePct).toBeLessThan(r.donePct);
  });

  test("a failed call does not do the step", () => {
    const r = scoreSop(BOOK, [call("list_alarms", false), call("facility_status")]);
    expect(r.steps[0]?.done).toBe(false);
    expect(r.skipped).toEqual(["s1", "s2"]);
  });

  test("tools used that change the world and that no step names are listed, not penalised", () => {
    const r = scoreSop(BOOK, [call("list_alarms"), call("power_server"), call("get_entity")]);
    expect(r.extra).toEqual(["power_server"]);
    expect(r.done).toBe(1);
  });

  test("no calls follow nothing, and a runbook with no scored step is followed in full", () => {
    expect(scoreSop(BOOK, [])).toMatchObject({ done: 0, donePct: 0, compliancePct: 0 });
    expect(scoreSop({ title: "x", steps: [] }, [])).toMatchObject({
      scored: 0,
      compliancePct: 100,
    });
  });
});

describe("a draft from the best run [REQ-082]", () => {
  test("the successful calls in order, a step per tool in a row, without waiting or the answer", () => {
    const draft = draftFromCalls(
      [
        { tool: "list_alarms", ok: true },
        { tool: "list_alarms", ok: true },
        { tool: "get_entity", ok: true, args: { id: "crah-1" } },
        { tool: "wait", ok: true },
        { tool: "set_cooling_setpoint", ok: true, args: { unitId: "crah-2", celsius: 17 } },
        { tool: "restart_cooling_unit", ok: false },
        { tool: "submit_diagnosis", ok: true },
      ],
      "초안",
    );
    expect(draft.title).toBe("초안");
    expect(draft.steps.map((s) => s.tools)).toEqual([
      ["list_alarms"],
      ["get_entity"],
      ["set_cooling_setpoint"],
    ]);
    expect(draft.steps[1]?.todo).toContain("crah-1");
    expect(draft.steps[2]?.todo.startsWith("조치")).toBe(true);
    expect(draft.steps[2]?.check).not.toBe("");
    expect(draft.steps.map((s) => s.id)).toEqual(["s1", "s2", "s3"]);
  });

  test("a draft followed to the letter complies in full", () => {
    const calls = [call("list_alarms"), call("get_entity"), call("set_cooling_setpoint")];
    expect(scoreSop(draftFromCalls(calls), calls).compliancePct).toBe(100);
  });
});

function play(sop: SopMode | undefined, tools: readonly string[] = DEFAULT_TOOLSET) {
  const t = ALL_SCENARIO_TEMPLATES.find((x) => x.id === "cooling-failure");
  if (!t) throw new Error("template");
  const scenario = { ...t.build(new BlueprintIndex(sampleBlueprint()), "sample"), runbook: BOOK };
  const s = Session.create({
    blueprint: sampleBlueprint(),
    scenario,
    tools,
    seed: 9,
    ...(sop ? { sop } : {}),
  });
  const task = s.start();
  return { s, task, scenario };
}

describe("the three ways to offer a runbook [REQ-082]", () => {
  test("not given: the task and the tools are what the scenario says", () => {
    const { s, task, scenario } = play("none");
    expect(task.prompt).not.toContain("절차서");
    expect(s.toolSpecs().map((t) => t.name)).not.toContain("search_runbooks");
    expect(scenario.runbook).toBe(BOOK);
  });

  test("given: the runbook is in the task", () => {
    const { task } = play("given");
    expect(task.prompt).toContain(runbookPrompt(BOOK).trim());
    expect(task.prompt).toContain("1. 알람 확인 [툴: list_alarms]");
  });

  test("found: the agent gets the search tool and finds the steps with it", () => {
    const { s, task } = play("search");
    expect(task.prompt).not.toContain("1. 알람 확인");
    expect(s.toolSpecs().map((t) => t.name)).toContain("search_runbooks");
    const r = s.call("search_runbooks", { query: "냉방기" });
    expect(r.ok).toBe(true);
    expect(JSON.stringify(r.data)).toContain("냉방 설정 낮추기");
  });

  test("not given and not found: searching answers that there is none", () => {
    const { s } = play("none", [...DEFAULT_TOOLSET, "search_runbooks"]);
    expect(s.call("search_runbooks", { query: "냉방기" }).data).toMatchObject({ runbooks: [] });
  });
});

describe("compliance is its own block, apart from the score [REQ-082]", () => {
  const run = (sop: SopMode | undefined) => {
    const { s } = play(sop);
    s.call("list_alarms", {});
    s.call("set_cooling_setpoint", { unitId: "crah-2", celsius: 17 });
    s.call("facility_status", {});
    s.call("submit_diagnosis", {
      rootCause: "crah-1",
      faultType: "cooling_unit_failure",
      summary: "냉방기 정지",
    });
    return s.finish();
  };

  test("the result carries how the runbook was offered and how closely it was followed", () => {
    const result = run("given");
    expect(result.sop).toMatchObject({
      mode: "given",
      title: "냉방기 정지 절차",
      done: 3,
      scored: 3,
      compliancePct: 100,
    });
  });

  test("the score does not change with the runbook: it is not mixed into the total", () => {
    const given = run("given");
    const none = run("none");
    expect(given.score.total).toBe(none.score.total);
    expect(given.score.items.map((i) => i.id)).toEqual(none.score.items.map((i) => i.id));
    expect(none.sop?.mode).toBe("none");
  });

  test("a scenario without a runbook has no block", () => {
    const t = ALL_SCENARIO_TEMPLATES.find((x) => x.id === "cooling-failure");
    const s = Session.create({
      blueprint: sampleBlueprint(),
      scenario: t?.build(new BlueprintIndex(sampleBlueprint()), "sample") as never,
      tools: DEFAULT_TOOLSET,
      seed: 9,
    });
    s.start();
    expect(s.finish().sop).toBeUndefined();
  });
});
