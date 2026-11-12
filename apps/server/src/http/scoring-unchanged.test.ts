import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import { sampleBlueprint } from "../../../../packages/core/src/world/test-support/sample";
import { parseConfig } from "../adapters";
import { recipe, testPlatform, until } from "../runtime/test-support/platform";
import { buildApp } from "./app";
import { authenticatorOf } from "./identity";

/**
 * Permissions decide who may do what; they must never touch what a run scores (the first pillar, ADR-0138). An
 * experiment run by a person who signed in through the proxy, on a world they made, scores exactly what it scored before
 * permissions existed: the fingerprint below was taken from the code before this change (same recipe, seed 1, the
 * built-in agent) and is changed only through the test-lock amend procedure with an ADR that explains the new score.
 */
const SECRET = "proxy-secret-for-tests-0003";
const SCORE_FINGERPRINTS: Readonly<Record<string, string>> = {
  "cooling-failure/triage": "8653eefa24e9f654",
  "cooling-failure/guess": "9b0401d80c056c06",
};

const fingerprint = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);

describe("scoring is unchanged with permissions on [REQ-054] [REQ-039]", () => {
  test("[REQ-054] [REQ-039] an experiment run behind the proxy has the score breakdown it had before permissions", async () => {
    const t = testPlatform();
    const authenticator = authenticatorOf(
      parseConfig({
        identity: { header: "x-forwarded-user", proxySecretEnv: "PROXY_SECRET_FOR_TESTS" },
      }).identity,
      { PROXY_SECRET_FOR_TESTS: SECRET },
    );
    const app = buildApp({ platform: t.platform, authenticator });
    const headers = { "x-terrarium-proxy-secret": SECRET, "x-forwarded-user": "haneul.kim" };
    const call = async (method: string, url: string, payload?: object) => {
      const r = await app.inject({
        method: method as "GET",
        url,
        headers,
        ...(payload ? { payload } : {}),
      });
      expect(r.statusCode, `${method} ${url}`).toBe(200);
      return r.json();
    };
    const world = (await call("POST", "/api/worlds", { name: "홀", blueprint: sampleBlueprint() }))
      .world;
    const scenario = (
      await call("POST", "/api/scenarios", { worldId: world.id, templateId: "cooling-failure" })
    ).scenario;
    const seen: Record<string, string> = {};
    for (const agentId of ["triage", "guess"]) {
      const made = await call("POST", "/api/experiments", {
        name: agentId,
        recipe: recipe(world.id, scenario.id, { agentId, seeds: [1] }),
      });
      const id = made.experiment.id as string;
      await until(
        async () => (await call("GET", `/api/experiments/${id}`)).progress.finished === 1,
      );
      const [run] = (await call("GET", `/api/experiments/${id}`)).runs as { id: string }[];
      const view = await call("GET", `/api/runs/${(run as { id: string }).id}`);
      expect(view.run.result.score.total, agentId).toBeGreaterThanOrEqual(0);
      seen[`cooling-failure/${agentId}`] = fingerprint(view.run.result.score);
    }
    expect(seen).toEqual(SCORE_FINGERPRINTS);
    await t.platform.stop();
  });
});
