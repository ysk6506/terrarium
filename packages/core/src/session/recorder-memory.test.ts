import { Catalog } from "@terrarium/core/catalog";
import { World } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { sampleBlueprint } from "../world/test-support/sample";
import { MetricRecorder } from ".";

const OPTIONS = { sampleSeconds: 30, retentionSeconds: 90 };

function recorderOn(world: World): MetricRecorder {
  return new MetricRecorder(world, OPTIONS);
}

function sample(world: World, recorder: MetricRecorder, times: number): void {
  for (let i = 0; i < times; i++) {
    recorder.sampleIfDue();
    world.advance(30);
  }
}

describe("the recorder holds only the samples a run took [REQ-032] [REQ-037]", () => {
  test("a run's memory grows with its samples, up to the ring", () => {
    const world = World.fromBlueprint(sampleBlueprint(), new Catalog());
    const recorder = recorderOn(world);
    const row = recorder.seriesCount * 4;
    const times = 4 * 8; // ceil(90 / 30) + 1 slots of 8 bytes
    expect(recorder.bytes).toBe(times);
    sample(world, recorder, 2);
    expect(recorder.bytes).toBe(times + 2 * row);
    sample(world, recorder, 10);
    expect(recorder.bytes).toBe(times + 4 * row);
  });

  test("recorders over one blueprint share what the series are, and hold their own numbers", () => {
    const world = World.fromBlueprint(sampleBlueprint(), new Catalog());
    const other = World.fromBlueprint(sampleBlueprint(), new Catalog());
    const a = recorderOn(world);
    const b = recorderOn(other);
    expect(a.seriesCount).toBe(b.seriesCount);
    world.patch("srv-a1", "server", { cpuC: 71 });
    other.patch("srv-a1", "server", { cpuC: 33 });
    sample(world, a, 1);
    sample(other, b, 1);
    expect(a.series("srv-a1", "cpuC", 0)[0]?.[1]).toBeCloseTo(71, 4);
    expect(b.series("srv-a1", "cpuC", 0)[0]?.[1]).toBeCloseTo(33, 4);
  });

  test("a warm-start capture is never written into, by the recorder it came from or by one that adopted it", () => {
    const world = World.fromBlueprint(sampleBlueprint(), new Catalog());
    const source = recorderOn(world);
    world.patch("srv-a1", "server", { cpuC: 50 });
    sample(world, source, 3);
    const capture = source.capture();
    expect(capture?.count).toBe(3);
    const kept = (capture?.rows ?? []).map((r) => Array.from(r));

    const heir = recorderOn(World.fromBlueprint(sampleBlueprint(), new Catalog()));
    heir.adopt(capture as NonNullable<typeof capture>);
    expect(heir.series("srv-a1", "cpuC", 0).map(([, v]) => Math.round(v))).toEqual([50, 50, 50]);

    // Both go on past the ring's end, which writes over the oldest samples.
    world.patch("srv-a1", "server", { cpuC: 99 });
    sample(world, source, 6);
    const heirWorld = World.fromBlueprint(sampleBlueprint(), new Catalog());
    heirWorld.advance(90);
    heirWorld.patch("srv-a1", "server", { cpuC: 11 });
    const heir2 = new MetricRecorder(heirWorld, OPTIONS);
    heir2.adopt(capture as NonNullable<typeof capture>);
    sample(heirWorld, heir2, 6);

    expect((capture?.rows ?? []).map((r) => Array.from(r))).toEqual(kept);
  });
});
