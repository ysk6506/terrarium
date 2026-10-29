import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { SCENARIO_TEMPLATES } from "@terrarium/core/scenario";
import { Session } from "@terrarium/core/session";
import { DEFAULT_TOOLSET } from "@terrarium/core/tools";
import { BlueprintIndex } from "@terrarium/core/world";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { sampleBlueprint } from "../../../../packages/core/src/world/test-support/sample";
import { McpGateway, mcpResult } from "./gateway";
import { connectAgent } from "./test-support/mcp-agent";

let server: Server;
let base = "";
const gateway = new McpGateway("http://placeholder");

beforeAll(async () => {
  server = createServer((req, res) => {
    const m = /^\/mcp\/runs\/([^/]+)\/([^/]+)$/.exec(req.url ?? "");
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", async () => {
      const text = Buffer.concat(chunks).toString("utf8");
      const body = text ? (JSON.parse(text) as unknown) : undefined;
      const ok =
        m &&
        (await gateway.handle(decodeURIComponent(m[1] as string), m[2] as string, req, res, body));
      if (!ok) res.writeHead(404).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

function session(tools = DEFAULT_TOOLSET) {
  const blueprint = sampleBlueprint();
  const template = SCENARIO_TEMPLATES.find((t) => t.id === "cooling-failure");
  const s = Session.create({
    blueprint,
    scenario: template?.build(new BlueprintIndex(blueprint), "sample") as never,
    tools,
    seed: 1,
  });
  s.start();
  return s;
}

/** The gateway's URL, pointed at the test server. */
const local = (url: string) => url.replace("http://placeholder", base);

describe("each run's tools over MCP [REQ-008] [REQ-031]", () => {
  test("an agent lists exactly the run's tools and plays the run through them", async () => {
    const s = session(["list_alarms", "get_impact"]);
    const exposed = gateway.open("r-1", {
      specs: s.toolSpecs(),
      call: async (n, a) => s.call(n, a),
    });
    expect(exposed.url).toMatch(/^http:\/\/placeholder\/mcp\/runs\/r-1\/[0-9a-f]{36}$/);
    const agent = await connectAgent(local(exposed.url));
    expect((await agent.tools()).sort()).toEqual(["get_impact", "list_alarms", "submit_diagnosis"]);
    const alarms = await agent.call("list_alarms", { severity: "critical" });
    expect(alarms.isError).toBe(false);
    expect((alarms.data as { entityId: string }[]).some((a) => a.entityId === "crah-1")).toBe(true);
    const unknown = await agent.call("power_server", { id: "srv-a1", action: "off" });
    expect(unknown).toMatchObject({ isError: true });
    const done = await agent.call("submit_diagnosis", {
      rootCause: "crah-1",
      faultType: "cooling_unit_failure",
      summary: "정지",
    });
    expect(done.isError).toBe(false);
    expect(s.finish().score.passed).toBe(true);
    await agent.close();
    exposed.close();
    expect(gateway.openEndpoints).toBe(0);
  });

  test("a closed endpoint or another run's token reaches nothing", async () => {
    const s = session();
    const a = gateway.open("r-a", { specs: s.toolSpecs(), call: async (n, x) => s.call(n, x) });
    const token = a.url.split("/").at(-1) as string;
    expect(gateway.has("r-a", token)).toBe(true);
    expect(gateway.has("r-b", token)).toBe(false);
    const wrongRun = await fetch(`${base}/mcp/runs/r-b/${token}`, { method: "POST", body: "{}" });
    expect(wrongRun.status).toBe(404);
    a.close();
    await expect(connectAgent(local(a.url))).rejects.toThrow();
  });

  test("tool results read as JSON text; failures are marked as errors", () => {
    expect(mcpResult({ ok: true, data: { a: 1 } })).toEqual({
      content: [{ type: "text", text: '{"a":1}' }],
    });
    expect(mcpResult({ ok: true })).toEqual({ content: [{ type: "text", text: "null" }] });
    expect(mcpResult({ ok: false, error: "없다" })).toEqual({
      content: [{ type: "text", text: '{"error":"없다"}' }],
      isError: true,
    });
  });
});
