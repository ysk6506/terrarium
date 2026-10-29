/**
 * The whole path a real internal harness takes (REQ-030, REQ-031): an experiment created over HTTP,
 * its runs on session worker threads, the harness asked over the harness protocol, its agent calling
 * the run's tools over MCP with the real MCP client, and the result read back over HTTP.
 */
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { MemoryStore } from "@terrarium/core/experiments";
import { DEFAULT_TOOLSET } from "@terrarium/core/tools";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { buildAdapters, parseConfig } from "../../apps/server/src/adapters";
import { buildApp } from "../../apps/server/src/http";
import { McpGateway } from "../../apps/server/src/mcp";
import { connectAgent } from "../../apps/server/src/mcp/test-support/mcp-agent";
import { Platform, WorkerHost } from "../../apps/server/src/runtime";
import { sampleBlueprint } from "../../packages/core/src/world/test-support/sample";

interface RemoteRun {
  status: "running" | "finished" | "error";
  message?: string;
  calls: number;
}

/** A harness speaking terrarium.harness/1 whose agent works the alarms over MCP. */
function remoteHarness() {
  const runs = new Map<string, RemoteRun>();
  const started: Array<{ body: Record<string, unknown>; auth: string | undefined }> = [];
  const read = (req: IncomingMessage) =>
    new Promise<Record<string, unknown>>((resolve) => {
      let text = "";
      req.on("data", (c) => {
        text += c;
      });
      req.on("end", () => resolve(text ? (JSON.parse(text) as Record<string, unknown>) : {}));
    });
  async function agent(id: string, mcpUrl: string) {
    const run = runs.get(id) as RemoteRun;
    try {
      const mcp = await connectAgent(mcpUrl);
      const alarms = (await mcp.call("list_alarms", { severity: "critical" })).data as {
        entityId: string;
        code: string;
      }[];
      run.calls++;
      const cooling = alarms.find((a) => a.code === "cooling_stopped");
      await mcp.call("submit_diagnosis", {
        rootCause: cooling?.entityId ?? "unknown",
        faultType: "cooling_unit_failure",
        summary: "냉방기 정지가 열을 만든다",
      });
      run.calls++;
      await mcp.close();
      run.status = "finished";
    } catch (err) {
      run.status = "error";
      run.message = (err as Error).message;
    }
  }
  const server = createServer(async (req, res) => {
    const send = (status: number, body: unknown) =>
      res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
    if (req.method === "GET" && req.url === "/agents")
      return send(200, { agents: [{ id: "mcp-triage", name: "MCP 분류 에이전트" }] });
    if (req.method === "POST" && req.url === "/runs") {
      const body = await read(req);
      started.push({ body, auth: req.headers.authorization });
      runs.set(String(body.runId), { status: "running", calls: 0 });
      void agent(String(body.runId), (body.tools as { mcpUrl: string }).mcpUrl);
      return send(202, { accepted: true });
    }
    const m = /^\/runs\/(.+)$/.exec(req.url ?? "");
    const run = m ? runs.get(decodeURIComponent(m[1] as string)) : undefined;
    if (!run) return send(404, {});
    if (req.method === "DELETE") return send(200, {});
    return send(200, { ...run, usage: { inputTokens: 1000 * run.calls, outputTokens: 100 } });
  });
  return { server, started };
}

const listen = (s: Server) =>
  new Promise<number>((resolve) =>
    s.listen(0, "127.0.0.1", () => resolve((s.address() as AddressInfo).port)),
  );

const harness = remoteHarness();
let base = "";
let close: () => Promise<void> = async () => {};

beforeAll(async () => {
  const harnessPort = await listen(harness.server);
  const probe = createServer();
  const port = await listen(probe);
  await new Promise<void>((r) => probe.close(() => r()));
  base = `http://127.0.0.1:${port}`;
  const config = parseConfig({
    harnesses: [
      {
        kind: "http",
        id: "remote",
        name: "원격 하네스",
        url: `http://127.0.0.1:${harnessPort}`,
        tokenEnv: "REMOTE_TOKEN",
        pollSeconds: 0.05,
      },
    ],
  });
  const adapters = buildAdapters(config, {
    store: new MemoryStore(),
    env: { REMOTE_TOKEN: "s3cret" },
  });
  const host = new WorkerHost({ size: 2 });
  const gateway = new McpGateway(base);
  const platform = new Platform({ adapters, host, gateway, graceMs: 100 });
  const app = buildApp({ platform, gateway });
  await app.listen({ port, host: "127.0.0.1" });
  close = async () => {
    await app.close();
    await platform.stop();
    await host.close();
    await new Promise<void>((r) => harness.server.close(() => r()));
  };
}, 60_000);
afterAll(() => close());

async function api(method: string, path: string, body?: unknown) {
  const r = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", "x-terrarium-user": encodeURIComponent("연수") },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return (await r.json()) as any;
}

describe("a remote harness, end to end [REQ-030] [REQ-031] [REQ-008]", () => {
  test("experiment over HTTP → worker sessions → harness protocol → MCP tools → scored result", async () => {
    const meta = await api("GET", "/api/meta");
    const remote = (
      meta.harnesses as { id: string; status: string; agents: { id: string }[] }[]
    ).find((h) => h.id === "remote");
    expect(remote).toMatchObject({ status: "ok", agents: [{ id: "mcp-triage" }] });
    const { world } = await api("POST", "/api/worlds", {
      name: "홀",
      blueprint: sampleBlueprint(),
    });
    const { scenario } = await api("POST", "/api/scenarios", {
      worldId: (world as { id: string }).id,
      templateId: "cooling-failure",
    });
    const created = await api("POST", "/api/experiments", {
      name: "원격 하네스 실험",
      recipe: {
        worldId: (world as { id: string }).id,
        scenarioId: (scenario as { id: string }).id,
        harnessId: "remote",
        agentId: "mcp-triage",
        tools: DEFAULT_TOOLSET,
        runs: 2,
      },
    });
    const id = (created.experiment as { id: string }).id;
    let view: Record<string, unknown> = {};
    for (let i = 0; i < 300 && view.status !== "completed"; i++) {
      await new Promise((r) => setTimeout(r, 50));
      view = await api("GET", `/api/experiments/${id}`);
    }
    expect(view).toMatchObject({ status: "completed", passRate: 1 });
    expect(harness.started).toHaveLength(2);
    expect(harness.started[0]?.auth).toBe("Bearer s3cret");
    expect(harness.started[0]?.body).toMatchObject({
      protocol: "terrarium.harness/1",
      agentId: "mcp-triage",
    });
    const runId = (view.runs as { id: string }[])[0]?.id as string;
    const run = await api("GET", `/api/runs/${runId}`);
    expect(run).toMatchObject({
      run: {
        status: "completed",
        result: { endReason: "diagnosed" },
        harness: { inputTokens: 2000, outputTokens: 100 },
      },
      analysis: { diagnosis: { root: true, type: true } },
    });
    // The run is over, so its MCP endpoint is gone.
    const mcpUrl = (harness.started[0]?.body.tools as { mcpUrl: string }).mcpUrl;
    expect(mcpUrl.startsWith(`${base}/mcp/runs/`)).toBe(true);
    expect((await fetch(mcpUrl, { method: "POST", body: "{}" })).status).toBe(404);
  }, 60_000);
});
