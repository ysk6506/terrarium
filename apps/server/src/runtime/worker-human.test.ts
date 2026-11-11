import { SCENARIO_TEMPLATES } from "@terrarium/core/scenario";
import { DEFAULT_TOOLSET } from "@terrarium/core/tools";
import { BlueprintIndex } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { sampleBlueprint } from "../../../../packages/core/src/world/test-support/sample";
import type { FromWorker } from "./worker-protocol";
import { WorkerSessions } from "./worker-sessions";
import { identityOf } from "./world-cache";

const blueprint = sampleBlueprint();
const world = identityOf(blueprint);
const scenario = SCENARIO_TEMPLATES[0]?.build(new BlueprintIndex(blueprint), "sample") as never;

describe("a person's turn inside a session worker [REQ-081] [REQ-032]", () => {
  test("[REQ-081] the worker relays what a person did and the answer that wakes the waiting call", async () => {
    const out: FromWorker[] = [];
    const w = new WorkerSessions((m) => out.push(m));
    const config = {
      scenario,
      tools: [...DEFAULT_TOOLSET, "ask_human"],
      seed: 5,
      escalation: { mode: "wait" as const },
    };
    await w.handle({ kind: "open", id: "h", config, world, blueprint });
    await w.handle({
      kind: "call",
      id: "h",
      seq: 1,
      tool: "ask_human",
      args: { request: "냉방기가 안 켜져요" },
    });
    await w.handle({
      kind: "human",
      id: "h",
      seq: 2,
      op: { kind: "act", tool: "set_cooling_setpoint", args: { unitId: "crah-2", celsius: 17 } },
    });
    const acted = out.find((m) => m.kind === "humaned" && m.seq === 2);
    expect(acted).toMatchObject({
      kind: "humaned",
      act: { ok: true, tool: "set_cooling_setpoint" },
    });
    expect(acted).not.toHaveProperty("result");
    await w.handle({
      kind: "human",
      id: "h",
      seq: 3,
      op: { kind: "resolve", resolution: { kind: "reply", text: "곧 가요", waitedSeconds: 5 } },
    });
    const answered = out.find((m) => m.kind === "humaned" && m.seq === 3);
    expect(answered).toMatchObject({
      result: { ok: true, data: { reply: "곧 가요", from: "human" } },
    });
    expect(answered).not.toHaveProperty("act");
  });

  test("[REQ-081] a person's act that the world refuses comes back as a failure message", async () => {
    const out: FromWorker[] = [];
    const w = new WorkerSessions((m) => out.push(m));
    await w.handle({
      kind: "open",
      id: "h",
      config: { scenario, tools: DEFAULT_TOOLSET, seed: 5 },
      world,
      blueprint,
    });
    await w.handle({
      kind: "human",
      id: "h",
      seq: 4,
      op: { kind: "act", tool: "list_alarms", args: {} },
    });
    expect(out.at(-1)).toMatchObject({ kind: "failed", id: "h", seq: 4 });
  });
});
