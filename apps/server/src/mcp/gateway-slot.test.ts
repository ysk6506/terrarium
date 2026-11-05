import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { McpGateway } from "./gateway";
import { connectAgent } from "./test-support/mcp-agent";

let server: Server;
let base = "";
let gateway = new McpGateway("http://placeholder");

beforeAll(async () => {
  server = createServer((req, res) => {
    const m = /^\/mcp\/slots\/([^/]+)\/([^/]+)$/.exec(req.url ?? "");
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", async () => {
      const text = Buffer.concat(chunks).toString("utf8");
      const body = text ? (JSON.parse(text) as unknown) : undefined;
      const ok =
        m &&
        (await gateway.handleSlot(
          decodeURIComponent(m[1] as string),
          m[2] as string,
          req,
          res,
          body,
        ));
      if (!ok) res.writeHead(404).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

const local = (url: string) => url.replace("http://placeholder", base);

describe("a harness that reads its MCP servers from its own settings gets one fixed address [REQ-051]", () => {
  test("the address is the same every time, and a stranger's token is refused", () => {
    expect(gateway.slotUrl("hermes-1")).toBe(gateway.slotUrl("hermes-1"));
    expect(gateway.slotUrl("hermes-1")).toMatch(
      /^http:\/\/placeholder\/mcp\/slots\/hermes-1\/[0-9a-f]{36}$/,
    );
    expect(gateway.slotUrl("hermes-1")).not.toBe(gateway.slotUrl("hermes-2"));
    expect(gateway.hasSlot("hermes-1", "nope")).toBe(false);
  });

  test("the token can be made from the server's key, so it survives a restart", () => {
    const keyed = (key: string) => new McpGateway("http://x", "t", (slot) => `${key}-${slot}`);
    expect(keyed("a").slotUrl("s")).toBe(keyed("a").slotUrl("s"));
    expect(keyed("a").slotUrl("s")).not.toBe(keyed("b").slotUrl("s"));
  });

  test("with no run it lists the usual tools and says why a call does nothing; during a run it serves that run", async () => {
    gateway = new McpGateway("http://placeholder");
    const idle = await connectAgent(local(gateway.slotUrl("h")));
    const names = await idle.tools();
    expect(names).toContain("list_alarms");
    expect(names).toContain("submit_diagnosis");
    const refused = await idle.call("list_alarms", {});
    expect(refused.isError).toBe(true);
    expect(JSON.stringify(refused.data)).toContain("돌고 있는 실험이 없어요");

    const calls: string[] = [];
    const run = gateway.open(
      "r-9",
      {
        specs: [
          {
            name: "get_entity",
            title: "t",
            description: "d",
            category: "observe",
            inputSchema: { type: "object", properties: {}, required: [] },
            mutating: false,
          },
        ],
        call: async (name) => {
          calls.push(name);
          return { ok: true, data: { from: "run" } };
        },
      },
      "h",
    );
    const during = await connectAgent(local(gateway.slotUrl("h")));
    expect(await during.tools()).toEqual(["get_entity"]);
    expect((await during.call("get_entity", {})).data).toEqual({ from: "run" });
    expect(calls).toEqual(["get_entity"]);

    run.close();
    const after = await connectAgent(local(gateway.slotUrl("h")));
    expect(await after.tools()).toContain("list_alarms");
    await Promise.all([idle.close(), during.close(), after.close()]);
  });

  test("a run that ends does not take the address from a newer run of the same connection", () => {
    gateway = new McpGateway("http://placeholder");
    const endpoint = { specs: [], call: async () => ({ ok: true as const, data: 1 }) };
    const first = gateway.open("r-1", endpoint, "h");
    const second = gateway.open("r-2", endpoint, "h");
    first.close();
    expect(gateway.openEndpoints).toBe(1);
    second.close();
    expect(gateway.openEndpoints).toBe(0);
  });
});
