import { DEFAULT_TOOLSET } from "@terrarium/core/tools";
import { describe, expect, test } from "vitest";
import { sampleBlueprint } from "../../../../packages/core/src/world/test-support/sample";
import { testPlatform, until } from "../runtime/test-support/platform";
import { buildApp } from "./app";

const headers = { "x-terrarium-user": "haneul" };

describe("the rest of the API, route by route [REQ-030] [REQ-033] [REQ-040]", () => {
  test("worlds, scenarios, dry runs, forks, more runs, cancelling and telemetry", async () => {
    const { platform } = testPlatform();
    const a = buildApp({ platform });
    const call = async (method: string, url: string, payload?: object) => {
      const r = await a.inject({
        method: method as "GET",
        url,
        headers,
        ...(payload ? { payload } : {}),
      });
      return { status: r.statusCode, body: r.json() };
    };
    const generated = await call("POST", "/api/worlds/generate", {
      spec: {
        site: "cheonan",
        seed: 2,
        buildings: 1,
        floors: 1,
        roomsPerFloor: 1,
        rows: 2,
        racksPerRow: 3,
        fill: 0.5,
        gpuShare: 0,
        containment: "hot",
        coolingRedundancy: "N+1",
        powerRedundancy: "N",
        vmsPerHost: 0,
      },
    });
    expect(generated.body.world.origin).toBe("worldgen");
    const { body: saved } = await call("POST", "/api/worlds", {
      name: "홀",
      blueprint: sampleBlueprint(),
    });
    const worldId = saved.world.id;
    expect((await call("GET", `/api/worlds/${worldId}`)).body.blueprint.id).toBe(worldId);
    expect((await call("GET", "/api/worlds")).body).toHaveLength(2);
    const renamed = await call("PUT", `/api/worlds/${worldId}`, {
      baseDigest: saved.world.digest,
      name: "새 홀",
    });
    expect(renamed.body.world.name).toBe("새 홀");

    const { body: s } = await call("POST", "/api/scenarios", {
      worldId,
      templateId: "fan-failure-throttle",
    });
    const scenarioId = s.scenario.id;
    expect((await call("GET", `/api/scenarios?worldId=${worldId}`)).body).toHaveLength(1);
    expect((await call("GET", `/api/scenarios/${scenarioId}`)).body.id).toBe(scenarioId);
    const dry = await call("POST", `/api/scenarios/${scenarioId}/dry-run`, {});
    expect(dry.body.timeline.length).toBeGreaterThan(0);
    const updated = await call("PUT", `/api/scenarios/${scenarioId}`, {
      baseDigest: s.scenario.digest,
      name: "팬 고장",
    });
    expect(updated.body.scenario.name).toBe("팬 고장");

    const created = await call("POST", "/api/experiments", {
      name: "원본",
      recipe: {
        worldId,
        scenarioId,
        harnessId: "builtin",
        agentId: "guess",
        tools: DEFAULT_TOOLSET,
        seeds: [1],
      },
    });
    const id = created.body.experiment.id;
    await until(
      async () => (await call("GET", `/api/experiments/${id}`)).body.status === "completed",
    );
    const fork = await call("POST", `/api/experiments/${id}/fork`, {
      change: { agentId: "triage" },
    });
    expect(fork.body.experiment.parentId).toBe(id);
    const more = await call("POST", `/api/experiments/${id}/runs`, { count: 1 });
    expect(more.body.runs).toHaveLength(2);
    const cancelled = await call("POST", `/api/experiments/${fork.body.experiment.id}/cancel`);
    expect(cancelled.status).toBe(200);
    const run = (await call("GET", `/api/experiments/${id}`)).body.runs[0].id;
    expect((await call("GET", `/api/runs/${run}/telemetry`)).body).toEqual({
      spans: [],
      logs: [],
      metrics: [],
    });

    expect((await call("DELETE", `/api/scenarios/${scenarioId}`)).body).toEqual({ deleted: true });
    expect((await call("DELETE", `/api/worlds/${worldId}`)).body).toEqual({ deleted: true });
    expect((await a.inject({ url: "/healthz" })).json()).toEqual({ ok: true });
    await platform.stop();
  });
});
