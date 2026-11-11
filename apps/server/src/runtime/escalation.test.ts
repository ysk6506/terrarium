import { ForbiddenError, InvalidInputError } from "@terrarium/core/contract";
import type { RunResult } from "@terrarium/core/session";
import { describe, expect, test } from "vitest";
import {
  ADMIN,
  JIMIN,
  recipe,
  ScriptHarness,
  seed,
  settled,
  testPlatform,
  until,
  YEONSU,
} from "./test-support/platform";

const ASK = { request: "냉방기가 멈췄어요. 현장에서 봐 주실 수 있나요?" };

/** An agent that looks, asks for help, and writes down what it was told. */
function asker(told: unknown[]) {
  return new ScriptHarness("asker", async (req) => {
    await req.tools.call("list_alarms", {});
    told.push(await req.tools.call("ask_human", ASK));
    await req.tools.call("submit_diagnosis", {
      rootCause: "crah-1",
      faultType: "cooling_unit_failure",
      summary: "냉방기 정지",
    });
    return { status: "finished" };
  });
}

async function waiting(escalation: Record<string, unknown> = { mode: "wait" }) {
  const told: unknown[] = [];
  const { platform: p } = testPlatform([asker(told)]);
  const { world, scenario } = await seed(p);
  const created = await p.experiments.create(YEONSU, {
    name: "사람에게 묻기",
    recipe: recipe(world.id, scenario.id, {
      harnessId: "asker",
      agentId: "a",
      tools: ["list_alarms", "ask_human", "set_cooling_setpoint"],
      runs: 1,
      escalation,
    }),
  });
  return { p, told, id: created.experiment.id };
}

const resultOf = async (p: Awaited<ReturnType<typeof waiting>>["p"], id: string) => {
  const done = await settled(p, YEONSU, id);
  const run = await p.results.run(done.runs[0]?.id as string);
  return run.run.result as RunResult;
};

describe("a run that waits for a person [REQ-081]", () => {
  test("the card shows the request and the last calls, and a reply goes back as the tool result", async () => {
    const { p, told, id } = await waiting();
    await until(() => p.escalations.size === 1);
    const [card] = p.escalations.list();
    expect(card).toMatchObject({
      experimentId: id,
      experimentName: "사람에게 묻기",
      owner: "yeonsu",
      request: { request: ASK.request },
    });
    expect(card?.request.recent.map((c) => c.tool)).toEqual(["list_alarms"]);
    expect(card?.tools).toContain("ask_human");
    expect(card?.grantable.map((t) => t.name)).toContain("get_impact");
    expect(told).toEqual([]);
    await p.escalations.answer(YEONSU, card?.runId as string, { kind: "reply", text: "곧 가요" });
    const result = await resultOf(p, id);
    expect(told[0]).toMatchObject({ ok: true, data: { reply: "곧 가요", from: "human" } });
    expect(result.human).toMatchObject({ mode: "wait", count: 1 });
    expect(result.human?.waitedSeconds).toBeGreaterThanOrEqual(0);
    expect(p.escalations.size).toBe(0);
  });

  test("a person acts first; the run waits on, then the work goes back as a summary", async () => {
    const { p, told, id } = await waiting();
    await until(() => p.escalations.size === 1);
    const runId = p.escalations.list()[0]?.runId as string;
    const after = await p.escalations.answer(YEONSU, runId, {
      kind: "act",
      tool: "set_cooling_setpoint",
      args: { unitId: "crah-2", celsius: 17 },
    });
    expect(after?.acts).toHaveLength(1);
    expect(after?.acts[0]?.summary).toContain("냉방 설정 변경");
    expect(p.escalations.size).toBe(1);
    await p.escalations.answer(YEONSU, runId, { kind: "acted" });
    const result = await resultOf(p, id);
    expect(told[0]).toMatchObject({ data: { from: "human", changes: [after?.acts[0]?.summary] } });
    expect(result.human?.acts).toHaveLength(1);
  });

  test("handing over tools gives the agent more tools", async () => {
    const { p, id } = await waiting();
    await until(() => p.escalations.size === 1);
    const runId = p.escalations.list()[0]?.runId as string;
    await p.escalations.answer(YEONSU, runId, { kind: "more_tools", tools: ["get_impact"] });
    expect((await resultOf(p, id)).human?.granted).toEqual(["get_impact"]);
  });

  test("a person can end the run", async () => {
    const { p, id } = await waiting();
    await until(() => p.escalations.size === 1);
    await p.escalations.answer(YEONSU, p.escalations.list()[0]?.runId as string, { kind: "end" });
    expect((await resultOf(p, id)).endReason).toBe("escalated");
  });

  test("only the one who ran the experiment answers", async () => {
    const { p, id } = await waiting();
    await until(() => p.escalations.size === 1);
    const runId = p.escalations.list()[0]?.runId as string;
    await expect(
      p.escalations.answer(JIMIN, runId, { kind: "reply", text: "x" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await p.escalations.answer(YEONSU, runId, { kind: "end" });
    await settled(p, YEONSU, id);
    await expect(p.escalations.answer(YEONSU, runId, { kind: "end" })).rejects.toThrow(
      "사람을 기다리고 있지 않아요",
    );
  });

  test("stopping the experiment while it waits ends the wait", async () => {
    const { p, id } = await waiting();
    await until(() => p.escalations.size === 1);
    await p.experiments.cancel(YEONSU, id);
    await until(() => p.escalations.size === 0);
    const done = await settled(p, YEONSU, id);
    expect(done.status).toBe("cancelled");
  });
});

describe("the setup answers for the person [REQ-081]", () => {
  test("a fixed answer comes at once and nothing waits", async () => {
    const { p, told, id } = await waiting({ mode: "auto", reply: "정해 둔 답이에요" });
    const result = await resultOf(p, id);
    expect(told[0]).toMatchObject({ data: { reply: "정해 둔 답이에요", from: "auto" } });
    expect(result.human).toMatchObject({ mode: "auto", count: 1, waitedSeconds: 0 });
  });

  test("failing the run on asking ends it as escalated", async () => {
    const { p, id } = await waiting({ mode: "fail" });
    expect((await resultOf(p, id)).endReason).toBe("escalated");
  });
});

describe("the settings of an experiment [REQ-080] [REQ-081] [REQ-082]", () => {
  test("they are kept with the recipe, shown in a fork's changes and checked", async () => {
    const { p, id } = await waiting({ mode: "auto" });
    const parent = await p.experiments.get(id);
    expect(parent.recipe.escalation).toEqual({ mode: "auto" });
    const fork = await p.experiments.fork(YEONSU, id, {
      change: { escalation: { mode: "fail" }, faultScope: "inside", sop: "none" },
    });
    expect(fork.experiment.recipe).toMatchObject({
      escalation: { mode: "fail" },
      faultScope: "inside",
      sop: "none",
    });
    expect(fork.experiment.benchmarkKey).not.toBe(parent.benchmarkKey);
  });

  test("faults limited to the given tools refuse a scenario those tools cannot solve, naming the tool", async () => {
    const { platform: p } = testPlatform();
    const { world, scenario } = await seed(p);
    await expect(
      p.experiments.create(YEONSU, {
        name: "범위 밖",
        recipe: recipe(world.id, scenario.id, {
          tools: ["list_alarms", "get_entity"],
          faultScope: "inside",
        }),
      }),
    ).rejects.toMatchObject({
      issues: [
        { path: "recipe.faultScope", message: expect.stringContaining("set_cooling_setpoint") },
      ],
    });
    const ok = await p.experiments.create(YEONSU, {
      name: "범위 안",
      recipe: recipe(world.id, scenario.id, { faultScope: "inside" }),
    });
    expect(ok.experiment.recipe.faultScope).toBe("inside");
  });

  test("finding the runbook is a tool the agent needs, so choosing it gives the tool", async () => {
    const { platform: p } = testPlatform();
    const { world, scenario } = await seed(p);
    const made = await p.experiments.create(YEONSU, {
      name: "찾게 함",
      recipe: recipe(world.id, scenario.id, { sop: "search" }),
    });
    expect(made.experiment.recipe.tools).toContain("search_runbooks");
    await expect(
      p.experiments.create(YEONSU, {
        name: "도구만",
        recipe: recipe(world.id, scenario.id, { tools: ["list_alarms", "search_runbooks"] }),
      }),
    ).rejects.toBeInstanceOf(InvalidInputError);
  });
});

describe("a draft runbook from the best run [REQ-082]", () => {
  test("it is made from the calls of the run with the highest score, and says which run", async () => {
    const walker = new ScriptHarness("walker", async (req) => {
      await req.tools.call("list_alarms", {});
      await req.tools.call("get_entity", { id: "crah-1" });
      await req.tools.call("set_cooling_setpoint", { unitId: "crah-2", celsius: 17 });
      await req.tools.call("submit_diagnosis", {
        rootCause: "crah-1",
        faultType: "cooling_unit_failure",
        summary: "냉방기 정지",
      });
      return { status: "finished" };
    });
    const { platform: p } = testPlatform([walker]);
    const { world, scenario } = await seed(p);
    expect(await p.scenarios.runbookDraft(ADMIN, scenario.id)).toEqual({});
    const made = await p.experiments.create(YEONSU, {
      name: "기준선",
      recipe: recipe(world.id, scenario.id, { harnessId: "walker", agentId: "a", runs: 2 }),
    });
    await settled(p, YEONSU, made.experiment.id);
    const draft = await p.scenarios.runbookDraft(ADMIN, scenario.id);
    expect(draft.from).toMatchObject({ experimentName: "기준선" });
    expect(draft.from?.score).toBeGreaterThan(50);
    expect(draft.runbook?.steps.map((s) => s.tools)).toEqual([
      ["list_alarms"],
      ["get_entity"],
      ["set_cooling_setpoint"],
    ]);
  });
});
