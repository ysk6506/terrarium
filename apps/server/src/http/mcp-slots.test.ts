import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { McpGateway } from "../mcp";
import { connectAgent } from "../mcp/test-support/mcp-agent";
import { testPlatform } from "../runtime/test-support/platform";
import { buildApp } from "./app";

const gateway = new McpGateway("http://placeholder");
const app = buildApp({ platform: testPlatform().platform, gateway });
let base = "";

beforeAll(async () => {
  await app.listen({ port: 0, host: "127.0.0.1" });
  base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
});
afterAll(() => app.close());

describe("a fixed tool address is served by the app [REQ-051]", () => {
  test("a harness with the right address gets the tools; a wrong token gets 404 with a reason", async () => {
    const url = gateway.slotUrl("hermes-1").replace("http://placeholder", base);
    const agent = await connectAgent(url);
    expect(await agent.tools()).toContain("list_alarms");
    await agent.close();

    const wrong = await fetch(url.replace(/[^/]+$/, "not-the-token"), { method: "POST" });
    expect(wrong.status).toBe(404);
    expect(await wrong.json()).toEqual({
      error: { code: "not_found", message: "이 연결의 고정 툴 주소가 아니에요" },
    });
  });
});
