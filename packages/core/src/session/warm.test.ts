import { Catalog } from "@terrarium/core/catalog";
import { SCENARIO_TEMPLATES } from "@terrarium/core/scenario";
import { DEFAULT_TOOLSET } from "@terrarium/core/tools";
import { BlueprintIndex, World } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { sampleBlueprint } from "../world/test-support/sample";
import { MetricRecorder, Session, type SessionConfig, WarmStartCache } from ".";

const scenario = (id: string) => {
  const t = SCENARIO_TEMPLATES.find((x) => x.id === id);
  if (!t) throw new Error(id);
  return t.build(new BlueprintIndex(sampleBlueprint()), "sample");
};

const config = (id: string, extra: Partial<SessionConfig> = {}): SessionConfig => ({
  blueprint: sampleBlueprint(),
  scenario: scenario(id),
  tools: DEFAULT_TOOLSET,
  seed: 7,
  ...extra,
});

/** A fixed little investigation, so two runs can be compared result for result. */
function play(c: SessionConfig) {
  const s = Session.create(c);
  const task = s.start();
  const answers = [
    s.call("list_alarms", {}),
    s.call("wait", { seconds: 120 }),
    s.call("list_alarms", {}),
  ];
  return { task, answers, result: s.finish("agent_finished") };
}

describe("warm start [REQ-032] [REQ-042] [REQ-001]", () => {
  test("a session started from the cache runs exactly like one that warmed up itself", () => {
    const cache = new WarmStartCache();
    const cold = play(config("cooling-failure"));
    const first = play(config("cooling-failure", { warm: cache }));
    const second = play(config("cooling-failure", { warm: cache }));
    expect([cache.misses, cache.hits, cache.size]).toEqual([1, 1, 1]);
    expect(first).toEqual(cold);
    expect(second).toEqual(cold);
  });

  test("the warm-up does not depend on the scenario or the seed, so they may differ between hits", () => {
    const cache = new WarmStartCache();
    play(config("cooling-failure", { warm: cache }));
    for (const [id, seed] of [
      ["cooling-failure", 99],
      ["pdu-breaker-cascade", 7],
    ] as const) {
      const warm = play(config(id, { seed, warm: cache }));
      expect(warm).toEqual(play(config(id, { seed })));
    }
    expect(cache.hits).toBe(2);
  });

  test("worlds do not leak into each other: a run that damages the world leaves the cache clean", () => {
    const cache = new WarmStartCache();
    const a = Session.create(config("cooling-failure", { warm: cache }));
    a.start();
    a.call("power_server", { id: "srv-a1", action: "off" });
    const b = Session.create(config("cooling-failure", { warm: cache }));
    b.start();
    expect(b.world.events().length).toBeLessThan(a.world.events().length);
    const cold = Session.create(config("cooling-failure"));
    cold.start();
    expect(b.world.stateOf("srv-a1")).toEqual(cold.world.stateOf("srv-a1"));
    expect(b.world.events()).toEqual(cold.world.events());
  });

  test("a different warm-up length, recorder setting or catalog is a different key", () => {
    const cache = new WarmStartCache();
    play(config("cooling-failure", { warm: cache }));
    play(config("cooling-failure", { warm: cache, warmupSeconds: 300 }));
    play(config("cooling-failure", { warm: cache, sampleSeconds: 60 }));
    play(config("cooling-failure", { warm: cache, retentionSeconds: 7200 }));
    expect([cache.size, cache.hits]).toEqual([4, 0]);
    play(config("cooling-failure", { warm: cache, catalog: new Catalog() }));
    expect([cache.size, cache.hits, cache.misses]).toEqual([4, 0, 4]);
  });

  test("the cache keeps the most recently used worlds and forgets the rest", () => {
    const cache = new WarmStartCache(2);
    const warm = (w: number) => play(config("cooling-failure", { warm: cache, warmupSeconds: w }));
    warm(100);
    warm(200);
    warm(100);
    warm(300);
    expect(cache.size).toBe(2);
    const hits = cache.hits;
    warm(100);
    expect(cache.hits).toBe(hits + 1);
    warm(200);
    expect(cache.hits).toBe(hits + 1);
  });

  test("a warm-up longer than the recorder's memory is simply not cached", () => {
    const cache = new WarmStartCache();
    play(config("cooling-failure", { warm: cache, retentionSeconds: 120 }));
    expect(cache.size).toBe(0);
  });

  test("a recorder capture only fits a recorder of the same shape", () => {
    const world = World.fromBlueprint(sampleBlueprint(), new Catalog());
    const small = new MetricRecorder(world, { sampleSeconds: 30, retentionSeconds: 60 });
    const roomy = new MetricRecorder(world, { sampleSeconds: 30, retentionSeconds: 3600 });
    for (let i = 0; i < 5; i++) {
      world.advance(30);
      roomy.sampleIfDue();
    }
    const capture = roomy.capture();
    expect(capture?.count).toBe(5);
    expect(() => small.adopt(capture as NonNullable<typeof capture>)).toThrow(/does not fit/);
  });
});
