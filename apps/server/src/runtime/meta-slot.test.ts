import { MemoryStore } from "@terrarium/core/experiments";
import { describe, expect, test } from "vitest";
import { FakeFetch, json } from "../adapters/test-support/fake-fetch";
import { HANEUL, testPlatform } from "./test-support/platform";

describe("the new-experiment screen is told which harness has a fixed tool address [REQ-051]", () => {
  test("the meta of a harness with a slot names it, and a plain harness has none", async () => {
    const fake = new FakeFetch()
      .on("GET", /^\/v1\/models$/, () => json({ data: [{ id: "hermes-agent" }] }))
      .on("GET", /^\/agents$/, () => json({ agents: [{ id: "a", name: "에이전트" }] }));
    const gateway = {
      open: () => ({ url: "https://t.test/run", close: () => undefined }),
      slotUrl: (slot: string) => `https://t.test/mcp/slots/${slot}/secret`,
    };
    const { platform } = testPlatform(
      [],
      { gateway, adapters: { connect: { env: {}, fetch: fake.fetch } } },
      new MemoryStore(),
    );
    const hermes = await platform.connections.create(HANEUL, {
      connector: "hermes",
      name: "내 헤르메스",
      config: { url: "https://hermes.test" },
    });
    const plain = await platform.connections.create(HANEUL, {
      connector: "http",
      name: "회사 하네스",
      config: { url: "https://harness.test" },
    });
    const meta = await platform.meta(HANEUL);
    expect(meta.harnesses.find((h) => h.id === hermes.id)?.mcpSlot).toBe(hermes.id);
    expect(meta.harnesses.find((h) => h.id === plain.id)?.mcpSlot).toBeUndefined();
  });
});
