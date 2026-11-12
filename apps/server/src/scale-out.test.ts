import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { DEFAULT_LIMITS } from "@terrarium/core/experiments";
import { DEFAULT_TOOLSET } from "@terrarium/core/tools";
import { afterAll, describe, expect, test } from "vitest";
import { sampleBlueprint } from "../../../packages/core/src/world/test-support/sample";
import { parseConfig } from "./adapters";
import { type Running, run } from "./main";
import { withCapacity } from "./runtime";

const dir = mkdtempSync(path.join(tmpdir(), "terrarium-scale-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const TOKEN_ENV = "TERRARIUM_TEST_TOKEN";
const env = (file: string) => ({ TERRARIUM_CONFIG: file, [TOKEN_ENV]: "s".repeat(32) });
const auth = { authorization: `Bearer ${"s".repeat(32)}` };

const freePort = () =>
  new Promise<number>((resolve) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });

function configFile(name: string, body: object): string {
  const file = path.join(dir, `${name}.json`);
  writeFileSync(file, JSON.stringify({ host: "127.0.0.1", dataDir: `./${name}`, ...body }));
  return file;
}

async function until(check: () => Promise<boolean>, ms = 40_000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("기다리던 일이 일어나지 않았어요");
}

describe("scale out: a control plane with no sessions of its own, and workers that join it [REQ-042]", () => {
  test("queued runs wait for capacity, start when a worker joins, and the worker leaves politely", async () => {
    const controlPort = await freePort();
    const control = await run({
      env: env(
        configFile("control", {
          port: controlPort,
          cluster: { role: "control", tokenEnv: TOKEN_ENV, heartbeatSeconds: 1, nodeTtlSeconds: 5 },
        }),
      ),
      logger: false,
    });
    const api = async (method: string, url: string, payload?: object) => {
      const res = await fetch(`${control.url}${url}`, {
        method,
        headers: { "content-type": "application/json", "x-terrarium-user": "haneul" },
        ...(payload ? { body: JSON.stringify(payload) } : {}),
      });
      return (await res.json()) as Record<string, any>;
    };
    const metrics = async () =>
      (await (await fetch(`${control.url}/metrics`, { headers: auth })).text()).split("\n");
    let worker: Running | undefined;
    try {
      const { world } = await api("POST", "/api/worlds", {
        name: "홀",
        blueprint: sampleBlueprint(),
      });
      const { scenario } = await api("POST", "/api/scenarios", {
        worldId: world.id,
        templateId: "fan-failure-throttle",
      });
      const made = await api("POST", "/api/experiments", {
        name: "스케일 아웃",
        recipe: {
          worldId: world.id,
          scenarioId: scenario.id,
          harnessId: "builtin",
          agentId: "guess",
          tools: DEFAULT_TOOLSET,
          seeds: [1, 2, 3],
        },
      });
      const id = made.experiment.id as string;
      await until(async () => (await metrics()).includes("terrarium_runs_queued 3"));
      const waiting = await metrics();
      expect(waiting).toContain("terrarium_session_capacity 0");
      expect(waiting.some((l) => /^terrarium_nodes_wanted [1-9]/.test(l))).toBe(true);
      expect((await api("GET", `/api/experiments/${id}`)).status).not.toBe("completed");

      const workerPort = await freePort();
      worker = await run({
        env: env(
          configFile("worker", {
            port: workerPort,
            workers: 1,
            cluster: {
              role: "worker",
              tokenEnv: TOKEN_ENV,
              controlUrl: control.url,
              advertiseUrl: `http://127.0.0.1:${workerPort}`,
              nodeId: "w-test",
              heartbeatSeconds: 1,
              nodeTtlSeconds: 5,
              drainSeconds: 5,
            },
          }),
        ),
        logger: false,
      });
      await until(async () => (await api("GET", `/api/experiments/${id}`)).status === "completed");
      const nodes = (await (
        await fetch(`${control.url}/cluster/v1/nodes`, { headers: auth })
      ).json()) as { nodes: Array<{ id: string; slots: number }> };
      expect(nodes.nodes).toMatchObject([{ id: "w-test", slots: 32 }]);

      await worker.stop();
      worker = undefined;
      const after = (await (
        await fetch(`${control.url}/cluster/v1/nodes`, { headers: auth })
      ).json()) as { nodes: unknown[] };
      expect(after.nodes).toEqual([]);
      expect((await metrics()).some((l) => l === "terrarium_session_capacity 0")).toBe(true);
    } finally {
      await worker?.stop();
      await control.stop();
    }
  }, 120_000);

  test("one process stays one process: capacity is its own threads, no token needed", async () => {
    const port = await freePort();
    const single = await run({
      env: { TERRARIUM_CONFIG: configFile("single", { port, workers: 1 }) },
      logger: false,
    });
    // No token, no cluster endpoints, and a scraper is told so instead of being handed the web app.
    expect((await fetch(`${single.url}/metrics`)).status).toBe(404);
    expect((await fetch(`${single.url}/cluster/v1/nodes`)).status).toBe(404);
    await single.stop();
  }, 30_000);
});

describe("cluster settings fail early and say what to add [REQ-042]", () => {
  const parse = (cluster: object) => () => parseConfig({ cluster });

  test("each role names what it needs", () => {
    expect(parse({ role: "worker" })).toThrow("역할 worker에는 tokenEnv");
    expect(parse({ role: "worker", tokenEnv: "T" })).toThrow("controlUrl이 필요해요");
    expect(parse({ role: "control" })).toThrow("역할 control에는 tokenEnv");
    expect(parse({ role: "all", controlUrl: "http://c:1" })).toThrow(
      "controlUrl은 역할 worker에만",
    );
    expect(parse({ tokenEnv: "T", heartbeatSeconds: 10, nodeTtlSeconds: 15 })).toThrow(
      "nodeTtlSeconds는 heartbeatSeconds의 두 배보다 커야 해요",
    );
    expect(parseConfig({}).cluster).toMatchObject({ role: "all", sessionsPerThread: 32 });
    expect(
      parseConfig({ cluster: { role: "worker", tokenEnv: "T", controlUrl: "http://c:1" } }).cluster
        .role,
    ).toBe("worker");
  });

  test("a secret the file points at must exist", async () => {
    const file = configFile("nosecret", {
      port: await freePort(),
      cluster: { role: "control", tokenEnv: "TERRARIUM_NOT_SET" },
    });
    await expect(run({ env: { TERRARIUM_CONFIG: file }, logger: false })).rejects.toThrow(
      "환경 변수 TERRARIUM_NOT_SET",
    );
  });

  test("deployment systems set the role and addresses with environment variables", async () => {
    const file = configFile("envrole", { port: await freePort(), workers: 1 });
    const c = await run({
      env: {
        TERRARIUM_CONFIG: file,
        TERRARIUM_ROLE: "all",
        TERRARIUM_CLUSTER_TOKEN_ENV: TOKEN_ENV,
        [TOKEN_ENV]: "e".repeat(32),
      },
      logger: false,
    });
    const nodes = await fetch(`${c.url}/cluster/v1/nodes`, {
      headers: { authorization: `Bearer ${"e".repeat(32)}` },
    });
    expect(nodes.status).toBe(200);
    await c.stop();
  }, 30_000);
});

describe("limits follow capacity [REQ-042]", () => {
  test("unset caps are shares of the capacity; set caps stay as set", () => {
    let capacity = 40;
    const follow = withCapacity({ ...DEFAULT_LIMITS }, undefined, () => capacity);
    expect(follow).toMatchObject({ maxRunning: 40, perUser: 10, perHarness: 20 });
    capacity = 1000;
    expect(follow).toMatchObject({ maxRunning: 1000, perUser: 250, perHarness: 500 });
    capacity = 0;
    expect(follow.maxRunning).toBe(0);
    expect(follow.perUser).toBe(DEFAULT_LIMITS.perUser);
    const fixed = withCapacity(
      { ...DEFAULT_LIMITS, maxRunning: 50, perUser: 3 },
      { maxRunning: 50, perUser: 3 },
      () => 1000,
    );
    expect(fixed).toMatchObject({ maxRunning: 50, perUser: 3, perHarness: 500 });
  });
});
