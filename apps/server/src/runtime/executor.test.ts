import type { AgentRunRequest } from "@terrarium/core/experiments";
import { describe, expect, test } from "vitest";
import type { ToolGateway } from "./executor";
import { newTraceparent } from "./executor";
import {
  HANEUL,
  recipe,
  ScriptHarness,
  seed,
  settled,
  testPlatform,
  untilStopped,
} from "./test-support/platform";

async function runWith(harness: ScriptHarness, options: Parameters<typeof testPlatform>[1] = {}) {
  const t = testPlatform([harness], options);
  const { world, scenario } = await seed(t.platform);
  const e = await t.platform.experiments.create(HANEUL, {
    name: "실행 하나",
    recipe: recipe(world.id, scenario.id, { harnessId: harness.info.id, agentId: "a", runs: 1 }),
  });
  const view = await settled(t.platform, HANEUL, e.experiment.id);
  const run = await t.store.getRun(view.runs[0]?.id as string);
  return { ...t, view, run: run as NonNullable<typeof run> };
}

const submit = (req: AgentRunRequest) =>
  req.tools.call("submit_diagnosis", {
    rootCause: "crah-1",
    faultType: "cooling_unit_failure",
    summary: "정지",
  });

describe("how a run ends [REQ-030] [REQ-031]", () => {
  test("after the diagnosis the harness gets a grace period, then is stopped; the run is scored", async () => {
    const h = new ScriptHarness("h", async (req) => {
      await req.tools.call("list_alarms", {});
      await submit(req);
      return untilStopped(req);
    });
    const { run } = await runWith(h);
    expect(run).toMatchObject({
      status: "completed",
      result: { endReason: "diagnosed", score: { passed: true } },
    });
    expect(h.requests[0]?.signal.aborted).toBe(true);
    expect(h.requests[0]).toMatchObject({
      seed: 1,
      agentId: "a",
      limits: { maxToolCalls: expect.any(Number) },
    });
    expect(h.requests[0]?.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    expect(run.harness?.traceId).toBe(h.requests[0]?.traceparent?.split("-")[1]);
  });

  test("a harness that stops without answering ends the run as 'no diagnosis'", async () => {
    const h = new ScriptHarness("h", async (req) => {
      await req.tools.call("list_alarms", {});
      return { status: "finished", message: "포기", harness: { inputTokens: 10 } };
    });
    const { run } = await runWith(h);
    expect(run).toMatchObject({
      status: "completed",
      result: { endReason: "agent_finished" },
      harness: { message: "포기", inputTokens: 10 },
    });
  });

  test("an error before the first tool call is infrastructure (failed); after it, the agent's (scored)", async () => {
    const early = await runWith(
      new ScriptHarness("h", async () => ({ status: "error", message: "모델 503" })),
    );
    expect(early.run).toMatchObject({
      status: "failed",
      error: "에이전트가 시작하지 못했어요: 모델 503",
    });
    const late = await runWith(
      new ScriptHarness("h", async (req) => {
        await req.tools.call("list_alarms", {});
        throw new Error("파싱 실패");
      }),
    );
    expect(late.run).toMatchObject({
      status: "completed",
      result: { endReason: "agent_error" },
      harness: { message: "파싱 실패" },
    });
    expect(late.view.analysis.endReasons).toEqual({ agent_error: 1 });
  });

  test("an agent past the wall-clock limit is scored as out of time", async () => {
    const h = new ScriptHarness("h", async (req) => {
      await req.tools.call("list_alarms", {});
      return untilStopped(req);
    });
    const { run } = await runWith(h, { wallLimitMs: 100 });
    expect(run).toMatchObject({ status: "completed", result: { endReason: "time_limit" } });
  });

  test("MCP harnesses get the run's endpoint from the gateway, closed when the run ends", async () => {
    const opened: string[] = [];
    const closed: string[] = [];
    const gateway: ToolGateway = {
      open: (runId, endpoint) => {
        opened.push(`${runId}:${endpoint.specs.length}`);
        return { url: `https://t/mcp/${runId}`, close: () => closed.push(runId) };
      },
    };
    const h = new ScriptHarness(
      "h",
      async (req) => {
        expect(req.tools.mcpUrl).toBe(`https://t/mcp/${req.runId}`);
        await submit(req);
        return { status: "finished" };
      },
      [{ id: "a", name: "a" }],
      "mcp",
    );
    const { run } = await runWith(h, { gateway });
    expect(run.status).toBe("completed");
    expect(opened).toHaveLength(1);
    expect(closed).toEqual([run.id]);
  });

  test("a run whose harness or world version has gone fails with the reason", async () => {
    const t = testPlatform();
    const { world, scenario } = await seed(t.platform);
    const e = await t.platform.experiments.create(HANEUL, {
      name: "x",
      recipe: recipe(world.id, scenario.id, { runs: 1 }),
    });
    await settled(t.platform, HANEUL, e.experiment.id);
    const [first] = await t.store.listRuns(e.experiment.id);
    const gone = { ...e.experiment, recipe: { ...e.experiment.recipe, harnessId: "retired" } };
    const replay = {
      ...(first as NonNullable<typeof first>),
      id: "again",
      status: "queued" as const,
    };
    delete (replay as { result?: unknown }).result;
    delete (replay as { startedAt?: unknown }).startedAt;
    delete (replay as { finishedAt?: unknown }).finishedAt;
    await t.store.putRun(replay);
    t.platform.dispatcher.enqueue(replay, gone);
    await settled(t.platform, HANEUL, e.experiment.id);
    expect(await t.store.getRun("again")).toMatchObject({
      status: "failed",
      error: "하네스 'retired'가 지금 설정에 없어요",
    });
    const lost = { ...e.experiment, snapshot: { ...e.experiment.snapshot, worldDigest: "gone" } };
    await t.store.putRun({ ...replay, id: "again2" });
    t.platform.dispatcher.enqueue({ ...replay, id: "again2" }, lost);
    await settled(t.platform, HANEUL, e.experiment.id);
    expect((await t.store.getRun("again2"))?.error).toBe(
      "세션을 열 수 없어요: 실험이 가리키는 세계 버전을 찾을 수 없어요",
    );
  });

  test("trace contexts are fresh W3C traceparents", () => {
    const a = newTraceparent();
    expect(a).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    expect(newTraceparent()).not.toBe(a);
  });
});
