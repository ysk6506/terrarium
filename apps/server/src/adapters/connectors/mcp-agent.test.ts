import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { z } from "zod";
import { runRequest } from "../test-support/run-request";
import { mcpAgentConnector } from "./mcp-agent";

/** What the agent tools were called with, and whether the caller was asked for a token. */
const heard: Array<{ tool: string; args: Record<string, unknown> }> = [];
const tokens: Array<string | undefined> = [];

function mcpServer(): McpServer {
  const server = new McpServer({ name: "agent-gateway", version: "1.0.0" });
  server.registerTool(
    "triage",
    {
      title: "분류 에이전트",
      description: "알람을 분류해요",
      inputSchema: { prompt: z.string(), tools_url: z.string().optional() },
    },
    async (args) => {
      heard.push({ tool: "triage", args });
      return { content: [{ type: "text", text: "원인은 팬 고장" }] };
    },
  );
  server.registerTool(
    "broken",
    { description: "늘 실패해요", inputSchema: { prompt: z.string() } },
    async (args) => {
      heard.push({ tool: "broken", args });
      return { isError: true, content: [{ type: "text", text: "모델이 없어요" }] };
    },
  );
  server.registerTool("slow", { inputSchema: { prompt: z.string() } }, async () => {
    await new Promise((r) => setTimeout(r, 3000));
    return { content: [{ type: "text", text: "늦게 끝" }] };
  });
  return server;
}

let http: Server;
let base: string;

beforeAll(async () => {
  http = createServer(async (req, res) => {
    tokens.push(req.headers.authorization);
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => void transport.close());
    await mcpServer().connect(transport);
    await transport.handleRequest(req, res, body);
  });
  await new Promise<void>((r) => http.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(http.address() as AddressInfo).port}/mcp`;
});
afterAll(() => new Promise<void>((r) => http.close(() => r())));

function connect(extra: Record<string, unknown> = {}, env = {}) {
  const parsed = mcpAgentConnector.schema.parse({
    kind: "mcp-agent",
    id: "gw",
    name: "게이트웨이",
    url: base,
    ...extra,
  });
  return mcpAgentConnector.connect(parsed, { env, fetch: (url, init) => fetch(url, init) });
}

describe("an agent that a server offers as an MCP tool [REQ-051]", () => {
  test("every tool the server lists is an agent, with its title and description", async () => {
    const agents = await connect({}, {}).agents();
    expect(agents.map((a) => a.id).sort()).toEqual(["broken", "slow", "triage"]);
    expect(agents.find((a) => a.id === "triage")).toEqual({
      id: "triage",
      name: "분류 에이전트",
      description: "알람을 분류해요",
    });
  });

  test("naming the tool makes it the only agent; naming one the server lacks says what it has", async () => {
    expect((await connect({ tool: "triage" }).agents()).map((a) => a.id)).toEqual(["triage"]);
    await expect(connect({ tool: "nope" }).agents()).rejects.toThrow(
      /서버에 'nope' 툴이 없어요 \(있는 것: .*triage/,
    );
  });

  test("a token goes out as a bearer header", async () => {
    tokens.length = 0;
    await connect({ tokenEnv: "GW" }, { GW: "tk" }).agents();
    expect(tokens.every((t) => t === "Bearer tk")).toBe(true);
  });

  test("a run calls the tool with the task, the tools' address and the fixed arguments", async () => {
    heard.length = 0;
    const out = await connect({ mcpUrlArg: "tools_url", extraArgs: { max_steps: 5 } }).run(
      runRequest({ agentId: "triage" }),
    );
    expect(out).toMatchObject({ status: "finished", harness: { message: "원인은 팬 고장" } });
    expect(heard[0]?.args).toMatchObject({
      prompt: '서버 "A"를 조사하라',
      tools_url: "https://terrarium.test/mcp/runs/r1/tok",
    });
  });

  test("a tool that reports an error, and a server that cannot be reached, end the run with a reason", async () => {
    const failed = await connect().run(runRequest({ agentId: "broken" }));
    expect(failed).toMatchObject({
      status: "error",
      message: "에이전트 툴이 오류를 냈어요: 모델이 없어요",
    });
    const lost = mcpAgentConnector.connect(
      mcpAgentConnector.schema.parse({
        kind: "mcp-agent",
        id: "x",
        name: "x",
        url: "http://127.0.0.1:1/mcp",
      }),
      { env: {}, fetch: (url, init) => fetch(url, init) },
    );
    expect((await lost.run(runRequest())).message).toContain("MCP 에이전트에 연결하지 못했어요");
  });

  test("stopping a run stops waiting for the tool", async () => {
    const stop = new AbortController();
    const done = connect().run(runRequest({ agentId: "slow", signal: stop.signal }));
    setTimeout(() => stop.abort(), 300);
    expect(await done).toEqual({ status: "cancelled" });
  });
});
