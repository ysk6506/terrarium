import { describe, expect, test } from "vitest";
import { sampleBlueprint } from "../../../../packages/core/src/world/test-support/sample";
import { testPlatform } from "../runtime/test-support/platform";
import { buildApp } from "./app";

const headers = { "x-terrarium-user": "haneul" };

/** The editor's "시험지 점검" (REQ-070): three agents with no model score the saved scenario. */
describe("checking the exam paper from the API [REQ-070] [REQ-033]", () => {
  async function setup() {
    const { platform } = testPlatform();
    const app = buildApp({ platform });
    const call = async (method: string, url: string, payload?: object) => {
      const r = await app.inject({
        method: method as "GET",
        url,
        headers,
        ...(payload ? { payload } : {}),
      });
      return { status: r.statusCode, body: r.json() };
    };
    const { body: world } = await call("POST", "/api/worlds", {
      name: "홀",
      blueprint: sampleBlueprint(),
    });
    const worldId = world.world.id as string;
    return { call, worldId };
  }

  test("a template scenario gets three scores and plain-language findings", async () => {
    const { call, worldId } = await setup();
    const { body: made } = await call("POST", "/api/scenarios", {
      worldId,
      templateId: "fan-failure-throttle",
    });
    const id = made.scenario.id as string;
    const { status, body } = await call("POST", `/api/scenarios/${id}/calibrate`, {});
    expect(status).toBe(200);
    expect(body.runs.map((r: { id: string }) => r.id)).toEqual(["idle", "guess", "knows"]);
    expect(body.issues).toEqual([]);
    // knowing nothing scores close to nothing, knowing the answer scores clearly more
    expect(body.floor).toBeLessThanOrEqual(10);
    expect(body.diagnosisOnly).toBeGreaterThanOrEqual(body.floor + 30);
    // this template gives full marks for the answer alone, and says so
    expect(body.diagnosisOnly).toBe(100);
    expect(body.warnings.join(" ")).toContain("정답만 말하면 만점");
  });

  test("the same seed gives the same scores", async () => {
    const { call, worldId } = await setup();
    const { body: made } = await call("POST", "/api/scenarios", {
      worldId,
      templateId: "fan-failure-throttle",
    });
    const url = `/api/scenarios/${made.scenario.id}/calibrate`;
    const first = await call("POST", url, { seed: 3 });
    const second = await call("POST", url, { seed: 3 });
    expect(second.body).toEqual(first.body);
  });

  test("a scenario with problems is not run, and the problems come back", async () => {
    const { call, worldId } = await setup();
    const { body: made } = await call("POST", "/api/scenarios", { worldId });
    const { status, body } = await call("POST", `/api/scenarios/${made.scenario.id}/calibrate`, {});
    expect(status).toBe(200);
    expect(body.runs).toEqual([]);
    expect(body.issues.length).toBeGreaterThan(0);
  });

  test("an unknown scenario is a 404 in Korean", async () => {
    const { call } = await setup();
    const { status, body } = await call("POST", "/api/scenarios/s_nope/calibrate", {});
    expect(status).toBe(404);
    expect(JSON.stringify(body)).toContain("시나리오");
  });
});
