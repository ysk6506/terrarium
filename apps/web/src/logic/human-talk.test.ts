import type { EscalationCard } from "@terrarium/core/contract";
import type { HumanSummary, SopResult } from "@terrarium/core/session";
import { TOOL_NAMES } from "@terrarium/core/tools";
import { describe, expect, test } from "vitest";
import { sampleBlueprint } from "../../../../packages/core/src/world/test-support/sample";
import { experiment, humanTalk, runbook } from ".";

describe("the form carries the settings [REQ-080] [REQ-081] [REQ-082]", () => {
  test("the defaults are a fixed answer, all faults and no runbook, and they leave the recipe as it was", () => {
    const d = experiment.emptyDraft();
    expect(d).toMatchObject({ escalation: { mode: "auto" }, faultScope: "all", sop: "none" });
    const r = experiment.recipeOf({
      ...d,
      worldId: "w",
      scenarioId: "s",
      harnessId: "h",
      agentId: "a",
    });
    expect(r?.escalation).toBeUndefined();
    expect(r?.faultScope).toBeUndefined();
    expect(r?.sop).toBeUndefined();
  });

  test("asking is part of the recipe only when the agent has the tool", () => {
    const base = {
      ...experiment.emptyDraft(),
      worldId: "w",
      scenarioId: "s",
      harnessId: "h",
      agentId: "a",
    };
    const wait = { ...base, escalation: { mode: "wait" as const } };
    expect(experiment.recipeOf(wait)?.escalation).toBeUndefined();
    const withTool = experiment.toggleTool(wait, "ask_human", true);
    expect(experiment.recipeOf(withTool)?.escalation).toEqual({ mode: "wait" });
    expect(experiment.recipeOf({ ...base, faultScope: "inside" })?.faultScope).toBe("inside");
  });

  test("finding the runbook and the finder tool are one choice", () => {
    const d = experiment.emptyDraft();
    const search = experiment.setSop(d, "search");
    expect(search.tools).toContain("search_runbooks");
    expect(experiment.setSop(search, "given")).toMatchObject({ sop: "given" });
    expect(experiment.setSop(search, "given").tools).not.toContain("search_runbooks");
    expect(experiment.toggleTool(d, "search_runbooks", true).sop).toBe("search");
    expect(experiment.toggleTool(search, "search_runbooks", false).sop).toBe("none");
    expect(experiment.withTools(d, ["list_alarms", "search_runbooks"]).sop).toBe("search");
    expect(experiment.withTools(search, ["list_alarms"]).sop).toBe("none");
  });

  test("the number of tools counts the answer that is always there", () => {
    const d = experiment.emptyDraft();
    expect(experiment.countTools(d)).toBe(new Set([...d.tools, "submit_diagnosis"]).size);
  });
});

describe("editing a runbook [REQ-082]", () => {
  const book = {
    title: "절차",
    steps: [
      { id: "s1", todo: "하나", check: "", tools: ["list_alarms"] },
      { id: "s2", todo: "둘", check: "", tools: [] },
      { id: "s3", todo: "셋", check: "", tools: ["wait"] },
    ],
  };

  test("steps are added, changed, moved and removed, and the ids follow the order", () => {
    const added = runbook.addStep(book);
    expect(added.steps).toHaveLength(4);
    expect(added.steps[3]).toMatchObject({ id: "s4", todo: "" });
    const moved = runbook.moveStep(book, "s3", -1);
    expect(moved.steps.map((s) => [s.id, s.todo])).toEqual([
      ["s1", "하나"],
      ["s2", "셋"],
      ["s3", "둘"],
    ]);
    expect(runbook.moveStep(book, "s1", -1)).toBe(book);
    expect(runbook.removeStep(book, "s2").steps.map((s) => [s.id, s.todo])).toEqual([
      ["s1", "하나"],
      ["s2", "셋"],
    ]);
    expect(runbook.changeStep(book, "s2", { todo: "둘!" }).steps[1]?.todo).toBe("둘!");
  });

  test("tools are added once and removed", () => {
    const more = runbook.addTool(book, "s2", "get_entity");
    expect(more.steps[1]?.tools).toEqual(["get_entity"]);
    expect(runbook.addTool(more, "s2", "get_entity")).toBe(more);
    expect(runbook.removeTool(more, "s2", "get_entity").steps[1]?.tools).toEqual([]);
  });

  test("a step stays within the limit and a step with no tool is counted as a thought", () => {
    const full = {
      title: "x",
      steps: Array.from({ length: 30 }, (_, i) => ({
        id: `s${i + 1}`,
        todo: "a",
        check: "",
        tools: [],
      })),
    };
    expect(runbook.addStep(full)).toBe(full);
    expect(runbook.thoughtSteps(book)).toBe(1);
  });

  test("pasted text becomes steps, or one step when it has no list", () => {
    expect(runbook.pasted("1. 알람 보기\n2. 고치기").runbook.steps).toHaveLength(2);
    expect(runbook.pasted("그냥 글").parsed).toBe(false);
  });
});

const card: EscalationCard = {
  runId: "r1",
  experimentId: "e1",
  experimentName: "냉방 기준선",
  owner: "yeonsu",
  agent: "triage",
  since: "2026-11-06T09:00:00Z",
  request: {
    t: 900,
    request: "냉방기가 안 켜져요",
    recent: [
      { tool: "list_alarms", ok: true, summary: "" },
      { tool: "restart_cooling_unit", ok: false, summary: "the unit has a fault" },
    ],
  },
  tools: ["list_alarms"],
  grantable: [],
  acts: [],
};

describe("the card of a run that waits [REQ-081]", () => {
  test("it says how long it has waited and shows the last calls as a person reads them", () => {
    expect(humanTalk.waitingSince(card, Date.parse("2026-11-06T09:03:00Z"))).toBe(
      "3분 전부터 기다려요",
    );
    expect(card.request.recent.map(humanTalk.recentLine)).toEqual([
      "알람 목록",
      "냉방기 재시작: the unit has a fault — 실패",
    ]);
  });

  test("what a person can do is done with the tools an agent has, to what the world has", () => {
    for (const a of humanTalk.HUMAN_ACTIONS) expect(TOOL_NAMES).toContain(a.tool);
    const setpoint = humanTalk.HUMAN_ACTIONS.find((a) => a.id === "setpoint");
    const targets = humanTalk.targetsOf(
      setpoint as NonNullable<typeof setpoint>,
      sampleBlueprint(),
    );
    expect(targets.map((t) => t.id)).toEqual(["crah-1", "crah-2"]);
    expect(setpoint?.args("crah-1", 17)).toEqual({ unitId: "crah-1", celsius: 17 });
    expect(humanTalk.targetsOf(setpoint as NonNullable<typeof setpoint>, undefined)).toEqual([]);
  });
});

describe("escalation and runbook compliance on a result [REQ-081] [REQ-082]", () => {
  test("three figures: how often it asked, how long a person kept it waiting, what people did", () => {
    const human: HumanSummary = {
      mode: "wait",
      count: 2,
      waitedSeconds: 185,
      acts: [
        { t: 900, tool: "restart_cooling_unit", args: {}, ok: true, summary: "crah-1 재시작" },
      ],
      granted: [],
    };
    const figures = humanTalk.escalationFigures(human);
    expect(figures.map((f) => [f.label, f.value])).toEqual([
      ["에스컬레이션", "2회"],
      ["기다린 시간", "3분 5초"],
      ["사람이 한 조치", "1개"],
    ]);
    expect(figures[0]?.hint).toContain("사람이 답할 때까지 기다림");
    expect(figures[2]?.hint).toBe("crah-1 재시작");
    expect(humanTalk.escalationFigures(undefined)).toEqual([]);
  });

  const sop: SopResult = {
    mode: "given",
    title: "냉방기 정지",
    steps: [
      {
        id: "s1",
        todo: "알람",
        tools: ["list_alarms"],
        scored: true,
        done: true,
        firstCall: 0,
        inOrder: true,
      },
      {
        id: "s2",
        todo: "설정",
        tools: ["set_cooling_setpoint"],
        scored: true,
        done: false,
        inOrder: false,
      },
      { id: "s3", todo: "상의", tools: [], scored: false, done: false, inOrder: false },
    ],
    scored: 2,
    done: 1,
    inOrder: 1,
    skipped: ["s2"],
    extra: [],
    donePct: 50,
    orderPct: 100,
    compliancePct: 50,
  };

  test("four figures apart from the score: the share followed, the steps done, the order, what was skipped", () => {
    const figures = humanTalk.sopFigures(sop);
    expect(figures.map((f) => [f.label, f.value])).toEqual([
      ["절차서 준수", "50%"],
      ["단계 수행", "1/2단계"],
      ["순서", "100%"],
      ["건너뜀", "1단계"],
    ]);
    expect(figures[0]?.hint).toContain("줌");
    expect(figures[0]?.hint).toContain("점수에는 섞이지 않아요");
    expect(humanTalk.sopFigures(undefined)).toEqual([]);
  });

  test("each step is done, late, skipped or only a thought", () => {
    expect(sop.steps.map(humanTalk.stepState)).toEqual(["done", "skipped", "thought"]);
    expect(
      humanTalk.stepState({ ...(sop.steps[0] as SopResult["steps"][number]), inOrder: false }),
    ).toBe("late");
    expect(humanTalk.STEP_LABELS.skipped).toBe("건너뛰었어요");
  });
});
