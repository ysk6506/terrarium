import { SCENARIO_TEMPLATES } from "@terrarium/core/scenario";
import { DEFAULT_TOOLSET } from "@terrarium/core/tools";
import { BlueprintIndex } from "@terrarium/core/world";
import { afterEach, describe, expect, test } from "vitest";
import { sampleBlueprint } from "../../../../packages/core/src/world/test-support/sample";
import { InProcessHost, type PlainSessionConfig } from "../runtime";
import { ClusterHost } from "./cluster-host";
import { NodeServer } from "./node-server";
import { NodeRegistry } from "./registry";

const TOKEN = "r".repeat(24);

const config = (seed: number): PlainSessionConfig => {
  const blueprint = sampleBlueprint();
  const template = SCENARIO_TEMPLATES.find((t) => t.id === "cooling-failure");
  if (!template) throw new Error("template");
  return {
    blueprint,
    scenario: template.build(new BlueprintIndex(blueprint), "sample"),
    tools: DEFAULT_TOOLSET,
    seed,
  };
};

const started: NodeServer[] = [];
afterEach(async () => {
  await Promise.all(started.splice(0).map((n) => n.close()));
});

async function startNode(id: string, slots: number) {
  const node = new NodeServer({
    host: new InProcessHost(),
    token: TOKEN,
    id,
    url: "http://127.0.0.1:1",
    slots,
    version: "test",
  });
  await node.app.listen({ port: 0, host: "127.0.0.1" });
  started.push(node);
  const address = node.app.server.address();
  return `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
}

/** A node that has one real slot, though the control plane was told it has two: it refuses the second session. */
async function hostWithBusyNode(placeWaitMs: number) {
  const url = await startNode("busy", 1);
  const registry = new NodeRegistry(20_000, {}, () => 1_000);
  registry.beat({ id: "busy", url, slots: 2, open: 0, draining: false, version: "test" });
  return new ClusterHost({ registry, token: TOKEN, placeWaitMs });
}

describe("a node that is full for a moment is waited for, not given up on [REQ-042]", () => {
  test("a session the node refuses starts as soon as the node frees a slot", async () => {
    const host = await hostWithBusyNode(10_000);
    const first = await host.open(config(1));
    const second = host.open(config(2));
    setTimeout(() => first.dispose(), 250);
    const session = await second;
    expect(host.placedOn("busy")).toBe(1);
    session.dispose();
    expect(host.placedOn("busy")).toBe(0);
  });

  test("it gives up, with the reason, when no slot frees in time", async () => {
    const host = await hostWithBusyNode(300);
    const first = await host.open(config(1));
    await expect(host.open(config(2))).rejects.toThrow("세션을 돌릴 자리가 없어요");
    expect(host.placedOn("busy")).toBe(1);
    first.dispose();
  });

  test("a refused attempt does not keep a slot it never got", async () => {
    const host = await hostWithBusyNode(100);
    const first = await host.open(config(1));
    await expect(host.open(config(2))).rejects.toThrow();
    await expect(host.open(config(3))).rejects.toThrow();
    expect(host.placedOn("busy")).toBe(1);
    first.dispose();
    expect(host.placedOn("busy")).toBe(0);
  });
});
