import type { AgentRunRequest } from "@terrarium/core/experiments";
import { TRUST_RULES, trustOf } from "@terrarium/core/session";
import { DEFAULT_TOOLSET } from "@terrarium/core/tools";
import { describe, expect, test } from "vitest";
import { sampleBlueprint } from "../../../../packages/core/src/world/test-support/sample";
import { ScriptHarness, testPlatform, until } from "../runtime/test-support/platform";
import { buildApp } from "./app";

/** The agents the harness offers, each doing what its name says: nothing, only looking, looking and fixing, fixing blind. */
const PLAYS: Readonly<Record<string, (req: AgentRunRequest) => Promise<void>>> = {
  nothing: async () => undefined,
  looks: async ({ tools }) => {
    await tools.call("get_entity", { id: "crah-1" });
    await tools.call("submit_diagnosis", { rootCause: "crah-1", faultType: "x", summary: "y" });
  },
  fixes: async ({ tools }) => {
    await tools.call("get_entity", { id: "crah-1" });
    await tools.call("get_impact", { id: "crah-1" });
    await tools.call("restart_cooling_unit", { unitId: "crah-1" });
    await tools.call("get_entity", { id: "crah-1" });
    await tools.call("submit_diagnosis", { rootCause: "crah-1", faultType: "x", summary: "y" });
  },
  blind: async ({ tools }) => {
    await tools.call("restart_cooling_unit", { unitId: "crah-1" });
    await tools.call("submit_diagnosis", { rootCause: "crah-1", faultType: "x", summary: "y" });
  },
};

function setup() {
  const harness = new ScriptHarness(
    "script",
    async (req) => {
      await PLAYS[req.agentId]?.(req);
      return { status: "finished" };
    },
    Object.keys(PLAYS).map((id) => ({ id, name: id })),
    "in-process",
  );
  const { platform } = testPlatform([harness]);
  const app = buildApp({ platform });
  const send = async (method: string, url: string, payload?: object) => {
    const r = await app.inject({
      method: method as "GET",
      url,
      headers: { "x-terrarium-user": "haneul" },
      ...(payload ? { payload } : {}),
    });
    return { status: r.statusCode, body: r.json() };
  };
  return { send, platform };
}

const TOOLS = [...new Set([...DEFAULT_TOOLSET, "get_impact", "restart_cooling_unit"])];

async function seed(send: ReturnType<typeof setup>["send"]) {
  const world = await send("POST", "/api/worlds", { name: "홀", blueprint: sampleBlueprint() });
  const worldId = world.body.world.id as string;
  const scenario = await send("POST", "/api/scenarios", { worldId, templateId: "cooling-failure" });
  return { worldId, scenarioId: scenario.body.scenario.id as string };
}

describe("the level and the rules over the API [REQ-123] [REQ-125]", () => {
  test("[REQ-123] [REQ-125] the level and the rules are in the recipe; the default is left out, and a wrong choice is refused with the reason", async () => {
    const { send } = setup();
    const { worldId, scenarioId } = await seed(send);
    const base = {
      worldId,
      scenarioId,
      harnessId: "script",
      agentId: "nothing",
      tools: TOOLS,
      seeds: [1],
    };
    const plain = await send("POST", "/api/experiments", { name: "기본", recipe: base });
    const saidDefault = await send("POST", "/api/experiments", {
      name: "기본이라 말함",
      recipe: { ...base, permission: "act", rules: [] },
    });
    const view = await send("POST", "/api/experiments", {
      name: "보기만",
      recipe: { ...base, permission: "view", rules: ["no_harm", "look_first"] },
    });
    expect(plain.body.experiment.recipe).not.toHaveProperty("permission");
    expect(plain.body.experiment.recipe).not.toHaveProperty("rules");
    expect(saidDefault.body.experiment.recipe).toEqual(plain.body.experiment.recipe);
    expect(saidDefault.body.experiment.benchmarkKey).toBe(plain.body.experiment.benchmarkKey);
    // the level is another task; the rules are in the list's order and are not
    expect(view.body.experiment.recipe).toMatchObject({
      permission: "view",
      rules: ["look_first", "no_harm"],
    });
    expect(view.body.experiment.benchmarkKey).not.toBe(plain.body.experiment.benchmarkKey);
    const onlyRules = await send("POST", "/api/experiments", {
      name: "규칙만",
      recipe: { ...base, rules: ["verify_after"] },
    });
    expect(onlyRules.body.experiment.benchmarkKey).toBe(plain.body.experiment.benchmarkKey);

    const unknownLevel = await send("POST", "/api/experiments", {
      name: "x",
      recipe: { ...base, permission: "approve" },
    });
    expect(unknownLevel.status).toBe(400);
    const unknownRule = await send("POST", "/api/experiments", {
      name: "x",
      recipe: { ...base, rules: ["be_nice"] },
    });
    expect(unknownRule.status).toBe(400);
    const twice = await send("POST", "/api/experiments", {
      name: "x",
      recipe: { ...base, rules: ["no_harm", "no_harm"] },
    });
    expect(twice.status).toBe(400);
    // the rule about impact needs the tool that shows it
    const noTool = await send("POST", "/api/experiments", {
      name: "x",
      recipe: { ...base, tools: [...DEFAULT_TOOLSET], rules: ["impact_first"] },
    });
    expect(noTool.status).toBe(400);
    expect(JSON.stringify(noTool.body)).toContain("get_impact");
  });

  test("[REQ-123] [REQ-125] the four stand-in agents get different rule results, in the run and in the experiment summary, and the record counts them again", async () => {
    const { send, platform } = setup();
    const { worldId, scenarioId } = await seed(send);
    const ids: Record<string, string> = {};
    for (const agentId of Object.keys(PLAYS)) {
      const made = await send("POST", "/api/experiments", {
        name: agentId,
        recipe: {
          worldId,
          scenarioId,
          harnessId: "script",
          agentId,
          tools: TOOLS,
          seeds: [1, 2],
          rules: [...TRUST_RULES],
        },
      });
      expect(made.status, JSON.stringify(made.body)).toBe(200);
      ids[agentId] = made.body.experiment.id as string;
    }
    const summary: Record<string, Record<string, number>> = {};
    for (const [agentId, id] of Object.entries(ids)) {
      await until(
        async () => (await send("GET", `/api/experiments/${id}`)).body.progress.finished === 2,
      );
      const view = (await send("GET", `/api/experiments/${id}`)).body;
      expect(view.analysis.trust.permission).toBe("act");
      summary[agentId] = Object.fromEntries(
        view.analysis.trust.rules.map((r: { rule: string; violations: number }) => [
          r.rule,
          r.violations,
        ]),
      );
      // one run, read from the record
      const run = (await send("GET", `/api/runs/${view.runs[0].id}`)).body.run;
      expect(run.result.trust.rules.map((r: { rule: string }) => r.rule)).toEqual([...TRUST_RULES]);
      expect(trustOf(run.result.events, undefined, [...TRUST_RULES])).toEqual(run.result.trust);
    }
    expect(summary.nothing).toEqual({
      look_first: 0,
      impact_first: 0,
      verify_after: 0,
      no_harm: 0,
    });
    expect(summary.looks).toEqual(summary.nothing);
    expect(summary.fixes).toEqual(summary.nothing);
    expect(summary.blind).toEqual({ look_first: 1, impact_first: 1, verify_after: 1, no_harm: 0 });
    await platform.stop();
  });

  test("[REQ-123] under 'view' the fixing agent's change does not reach the world, the run says the gate stopped it, and the summary counts it; a fork back to the default has no level", async () => {
    const { send, platform } = setup();
    const { worldId, scenarioId } = await seed(send);
    const made = await send("POST", "/api/experiments", {
      name: "보기만",
      recipe: {
        worldId,
        scenarioId,
        harnessId: "script",
        agentId: "blind",
        tools: TOOLS,
        seeds: [1, 2],
        permission: "view",
      },
    });
    const id = made.body.experiment.id as string;
    await until(
      async () => (await send("GET", `/api/experiments/${id}`)).body.progress.finished === 2,
    );
    const view = (await send("GET", `/api/experiments/${id}`)).body;
    expect(view.analysis.trust).toMatchObject({
      permission: "view",
      rules: [{ rule: "stay_in_scope", label: "내 범위 밖에 손대지 않는다", violations: 1 }],
    });
    const run = (await send("GET", `/api/runs/${view.runs[0].id}`)).body.run;
    expect(run.result.toolCalls[0]).toMatchObject({
      tool: "restart_cooling_unit",
      ok: false,
      blocked: "view",
    });
    expect(
      run.result.events.filter(
        (e: { kind: string; cause?: string }) =>
          e.kind === "world" && e.cause === "tool:restart_cooling_unit",
      ),
    ).toEqual([]);

    const fork = await send("POST", `/api/experiments/${id}/fork`, {
      change: { permission: "act" },
    });
    expect(fork.status).toBe(200);
    expect(fork.body.analysis.parent.changes).toEqual([
      { field: "permission", label: "권한 수준", before: "보기만", after: "스스로 조치" },
    ]);
    await platform.stop();
  });
});
