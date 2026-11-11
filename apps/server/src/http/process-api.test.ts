import { DEFAULT_TOOLSET } from "@terrarium/core/tools";
import { describe, expect, test } from "vitest";
import { sampleBlueprint } from "../../../../packages/core/src/world/test-support/sample";
import { testPlatform, until } from "../runtime/test-support/platform";
import { buildApp } from "./app";

function setup() {
  const { platform } = testPlatform();
  const app = buildApp({ platform });
  const send = async (method: string, url: string, payload?: object, who = "yeonsu") => {
    const r = await app.inject({
      method: method as "GET",
      url,
      headers: { "x-terrarium-user": encodeURIComponent(who) },
      ...(payload ? { payload } : {}),
    });
    return { status: r.statusCode, body: r.json() };
  };
  return { send };
}

const STEPS = [
  { who: "모니터링 담당", what: "알람 확인", minutes: 10, kind: "check" },
  { who: "서버팀", what: "현장 하드웨어 점검", minutes: 120, kind: "physical" },
  { who: "모니터링 담당", what: "서비스 확인", minutes: 20, kind: "check" },
];

async function seed(send: ReturnType<typeof setup>["send"]) {
  const world = await send("POST", "/api/worlds", { name: "홀", blueprint: sampleBlueprint() });
  const worldId = world.body.world.id as string;
  const scenario = await send("POST", "/api/scenarios", {
    worldId,
    templateId: "fan-failure-throttle",
  });
  return { worldId, scenarioId: scenario.body.scenario.id as string };
}

describe("지금 하는 방식 표 [REQ-112]", () => {
  test("[REQ-112] 안 적은 시나리오는 비어 있고, 적으면 단계·사람·시간이 더해져 돌아온다", async () => {
    const { send } = setup();
    const { scenarioId } = await seed(send);
    const empty = await send("GET", `/api/scenarios/${scenarioId}/current-process`);
    expect(empty.body).toMatchObject({ written: false, steps: [], canEdit: true });
    const saved = await send("PUT", `/api/scenarios/${scenarioId}/current-process`, {
      steps: STEPS,
    });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ written: true, owner: "yeonsu", canEdit: true });
    expect(saved.body.summary).toEqual({ steps: 3, people: 2, seconds: 150 * 60 });
    expect(
      (await send("GET", `/api/scenarios/${scenarioId}/current-process`)).body.steps,
    ).toHaveLength(3);
  });

  test("[REQ-112] 비거나 틀린 표는 받지 않고, 처음 적은 사람만 고친다", async () => {
    const { send } = setup();
    const { scenarioId } = await seed(send);
    const url = `/api/scenarios/${scenarioId}/current-process`;
    expect((await send("PUT", url, { steps: [] })).status).toBe(400);
    expect((await send("PUT", url, { steps: [{ ...STEPS[0], kind: "몰라" }] })).status).toBe(400);
    expect((await send("PUT", url, { steps: [{ ...STEPS[0], minutes: -1 }] })).status).toBe(400);
    expect((await send("PUT", url, { steps: [{ ...STEPS[0], who: "  " }] })).status).toBe(400);
    expect((await send("PUT", url, { steps: STEPS })).status).toBe(200);
    const other = await send("PUT", url, { steps: STEPS.slice(0, 1) }, "jimin");
    expect(other.status).toBe(403);
    expect((await send("GET", url, undefined, "jimin")).body.canEdit).toBe(false);
    expect((await send("PUT", url, { steps: STEPS.slice(0, 2) })).body.steps).toHaveLength(2);
    expect((await send("GET", "/api/scenarios/없는/current-process")).status).toBe(404);
  });
});

describe("실험의 전후 비교와 세계의 온톨로지 [REQ-112]", () => {
  test("[REQ-112] 잰 값은 실행 기록에서 나오고, 적은 표가 없으면 적은 값은 없다", async () => {
    const { send } = setup();
    const { worldId, scenarioId } = await seed(send);
    const created = await send("POST", "/api/experiments", {
      name: "비교",
      recipe: {
        worldId,
        scenarioId,
        harnessId: "builtin",
        agentId: "triage",
        tools: DEFAULT_TOOLSET,
        seeds: [1, 2],
      },
    });
    const id = created.body.experiment.id as string;
    await until(
      async () => (await send("GET", `/api/experiments/${id}`)).body.status === "completed",
    );
    const before = await send("GET", `/api/experiments/${id}/process`);
    expect(before.status).toBe(200);
    expect(before.body).toMatchObject({ runs: 2, hasScenario: true, scenarioId });
    expect(before.body.baseline).toBeUndefined();
    expect(before.body.delta).toBeUndefined();
    expect(before.body.measured.seconds).toBeGreaterThan(0);
    expect(before.body.ledger.rows[0]).toMatchObject({ tag: "agent" });
    await send("PUT", `/api/scenarios/${scenarioId}/current-process`, { steps: STEPS });
    const after = (await send("GET", `/api/experiments/${id}/process`)).body;
    expect(after.baseline).toEqual({ steps: 3, people: 2, seconds: 9000 });
    expect(after.delta.steps).toBe(after.measured.steps - 3);
    expect(after.delta.seconds).toBe(after.measured.seconds - 9000);
    // the same record gives the same numbers
    expect((await send("GET", `/api/experiments/${id}/process`)).body.measured).toEqual(
      after.measured,
    );
  });

  test("[REQ-112] 세계의 요구는 시나리오에서 뽑고, 실험을 고르면 쓴 것이 붙는다", async () => {
    const { send } = setup();
    const { worldId, scenarioId } = await seed(send);
    const plain = await send("GET", `/api/worlds/${worldId}/ontology`);
    expect(plain.status).toBe(200);
    expect(plain.body.needs.scenarios).toBe(1);
    expect(plain.body.needs.actions.length).toBeGreaterThan(0);
    expect(plain.body.use).toBeUndefined();
    const created = await send("POST", "/api/experiments", {
      name: "쓴 것",
      recipe: {
        worldId,
        scenarioId,
        harnessId: "builtin",
        agentId: "triage",
        tools: DEFAULT_TOOLSET,
        seeds: [1],
      },
    });
    const id = created.body.experiment.id as string;
    await until(
      async () => (await send("GET", `/api/experiments/${id}`)).body.status === "completed",
    );
    const used = await send("GET", `/api/worlds/${worldId}/ontology?experimentId=${id}`);
    expect(used.body.experiments.map((e: { id: string }) => e.id)).toContain(id);
    expect(used.body.use.runs).toBe(1);
    expect(used.body.use.actions).toHaveLength(plain.body.needs.actions.length);
    expect((await send("GET", `/api/worlds/${worldId}/ontology?experimentId=nope`)).status).toBe(
      404,
    );
  });
});
