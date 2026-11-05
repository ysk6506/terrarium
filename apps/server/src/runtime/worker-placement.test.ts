import { emptyScenario, SCENARIO_TEMPLATES } from "@terrarium/core/scenario";
import { DEFAULT_TOOLSET } from "@terrarium/core/tools";
import { BlueprintIndex } from "@terrarium/core/world";
import { afterAll, describe, expect, test } from "vitest";
import { sampleBlueprint } from "../../../../packages/core/src/world/test-support/sample";
import type { PlainSessionConfig } from "./hosts";
import { WorkerHost } from "./worker-host";

const world = (id: string): PlainSessionConfig => {
  const blueprint = { ...sampleBlueprint(), id };
  const template = SCENARIO_TEMPLATES.find((t) => t.id === "cooling-failure");
  if (!template) throw new Error("no template");
  return {
    blueprint,
    scenario: template.build(new BlueprintIndex(blueprint), id),
    tools: DEFAULT_TOOLSET,
    seed: 3,
  };
};

const host = new WorkerHost({ size: 2 });
afterAll(() => host.close());

describe("which thread a session goes to [REQ-032] [REQ-042]", () => {
  test("sessions of one world gather on a thread that holds it, and another world goes to the idle thread", async () => {
    expect(host.threadLoads).toEqual([0, 0]);
    const a1 = await host.open(world("alpha"));
    const a2 = await host.open(world("alpha"));
    expect([...host.threadLoads].sort()).toEqual([0, 2]);
    const b1 = await host.open(world("beta"));
    expect([...host.threadLoads].sort()).toEqual([1, 2]);
    for (const s of [a1, a2, b1]) s.dispose();
    expect(host.threadLoads).toEqual([0, 0]);
  });

  test("a thread that is much busier than the others does not keep getting the world", async () => {
    const sessions = [];
    for (let i = 0; i < 8; i++) sessions.push(await host.open(world("gamma")));
    const [low = 0, high = 0] = [...host.threadLoads].sort((a, b) => a - b);
    expect(low).toBeGreaterThanOrEqual(2);
    expect(high - low).toBeLessThanOrEqual(4);
    for (const s of sessions) s.dispose();
  });

  test("many sessions of one world opened at once all start, though the world goes to each thread once", async () => {
    const opened = await Promise.all(Array.from({ length: 6 }, () => host.open(world("epsilon"))));
    expect(opened).toHaveLength(6);
    for (const s of opened) expect(s.task).toBeDefined();
    for (const s of opened) s.dispose();
    expect(host.threadLoads).toEqual([0, 0]);
  });

  test("a world that does not run says why, and the thread stays usable", async () => {
    const broken = world("delta");
    const bad: PlainSessionConfig = {
      ...broken,
      scenario: { ...emptyScenario("x", "delta"), nodes: [] },
      tools: [],
    };
    await expect(host.open(bad)).rejects.toThrow();
    expect(host.threadLoads).toEqual([0, 0]);
    const ok = await host.open(world("delta"));
    ok.dispose();
  });
});

describe("when threads are full, sessions wait for memory instead of piling on [REQ-032] [REQ-042]", () => {
  // A small world costs about 0.5 MB a session and 0.2 MB once for the world.
  const small = (id: string) => world(id);

  test("a session over the promise waits until one ends, then starts", async () => {
    const tight = new WorkerHost({ size: 1, promisedMb: 1.6 });
    try {
      const a = await tight.open(small("zeta"));
      const b = await tight.open(small("zeta"));
      const c = tight.open(small("zeta"));
      await new Promise((r) => setTimeout(r, 100));
      expect(tight.waiting).toBe(1);
      expect(tight.threadLoads).toEqual([2]);
      a.dispose();
      const started = await c;
      expect(tight.waiting).toBe(0);
      expect(tight.threadLoads).toEqual([2]);
      for (const s of [b, started]) s.dispose();
      expect(tight.threadLoads).toEqual([0]);
    } finally {
      await tight.close();
    }
  });

  test("sessions that wait start in the order they came", async () => {
    const tight = new WorkerHost({ size: 1, promisedMb: 1.0 });
    try {
      const first = await tight.open(small("eta"));
      const order: number[] = [];
      const waiting = [1, 2, 3].map((n) =>
        tight.open(small("eta")).then((s) => {
          order.push(n);
          return s;
        }),
      );
      await new Promise((r) => setTimeout(r, 50));
      expect(tight.waiting).toBe(3);
      first.dispose();
      const sessions = [];
      for (const w of waiting) {
        const s = await w;
        sessions.push(s);
        s.dispose();
      }
      expect(order).toEqual([1, 2, 3]);
    } finally {
      await tight.close();
    }
  });

  test("a session that waits too long is told the host is full, and leaves the line", async () => {
    const tight = new WorkerHost({ size: 1, promisedMb: 0.8, admissionWaitMs: 150 });
    try {
      const a = await tight.open(small("theta"));
      await expect(tight.open(small("theta"))).rejects.toThrow(/메모리/);
      expect(tight.waiting).toBe(0);
      a.dispose();
      const again = await tight.open(small("theta"));
      again.dispose();
    } finally {
      await tight.close();
    }
  });

  test("closing the host sends the waiting away", async () => {
    const tight = new WorkerHost({ size: 1, promisedMb: 0.8 });
    const a = await tight.open(small("iota"));
    const waiting = tight.open(small("iota"));
    const answer = expect(waiting).rejects.toThrow(/멈추는/);
    await new Promise((r) => setTimeout(r, 30));
    await tight.close();
    await answer;
    a.dispose();
  });
});
