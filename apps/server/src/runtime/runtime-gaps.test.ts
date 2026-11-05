import { SCENARIO_TEMPLATES } from "@terrarium/core/scenario";
import { DEFAULT_TOOLSET } from "@terrarium/core/tools";
import { BlueprintIndex } from "@terrarium/core/world";
import { afterAll, describe, expect, test } from "vitest";
import { sampleBlueprint } from "../../../../packages/core/src/world/test-support/sample";
import { messageOf, metadataOf } from "./connection-form";
import { EventBus } from "./events";
import type { PlainSessionConfig } from "./hosts";
import { WorkerHost } from "./worker-host";

describe("what the server reports about itself and its subscribers [REQ-032] [REQ-050]", () => {
  const host = new WorkerHost({ size: 2 });
  afterAll(() => host.close());

  test("each thread says how much heap it uses and how much memory it has promised", async () => {
    const blueprint = { ...sampleBlueprint(), id: "gaps" };
    const template = SCENARIO_TEMPLATES.find((t) => t.id === "cooling-failure");
    if (!template) throw new Error("no template");
    const config: PlainSessionConfig = {
      blueprint,
      scenario: template.build(new BlueprintIndex(blueprint), "gaps"),
      tools: DEFAULT_TOOLSET,
      seed: 3,
    };
    const session = await host.open(config);
    const heap = await host.threadHeapMb();
    expect(heap).toHaveLength(2);
    for (const mb of heap) expect(mb).toBeGreaterThanOrEqual(0);
    expect(host.threadPromisedMb.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
    expect(host.waiting).toBe(0);
    session.dispose();
    expect(host.threadPromisedMb).toEqual([0, 0]);
  });

  test("a subscriber that throws does not stop the others, on an experiment or on a world", () => {
    const bus = new EventBus();
    const seen: string[] = [];
    bus.subscribe("e1", () => {
      throw new Error("broken");
    });
    bus.subscribe("e1", (event) => seen.push(event.type));
    bus.emit("e1", { type: "status" } as never);
    bus.subscribeWorld("w1", () => {
      throw new Error("broken");
    });
    bus.subscribeWorld("w1", (event) => seen.push(`world:${event.type}`));
    bus.emitWorld("w1", { type: "end", runId: "r1" } as never);
    expect(seen).toEqual(["status", "world:end"]);
  });

  test("an error says its reason in words, and a config entry keeps only its text values", () => {
    expect(messageOf("plain")).toBe("plain");
    expect(messageOf(new Error("boom"))).toBe("boom");
    expect(metadataOf({ team: "ai", n: 3, nested: { a: "b" } })).toEqual({ team: "ai" });
    expect(metadataOf(null)).toEqual({});
    expect(metadataOf("text")).toEqual({});
  });
});
