import { describe, expect, test } from "vitest";
import { sampleBlueprint } from "../../../../packages/core/src/world/test-support/sample";
import { BlueprintCache } from "./blueprint-cache";
import { identityOf, WorldCache } from "./world-cache";

const sample = sampleBlueprint();
const sized = (id: string, entities: number) => ({
  ...sample,
  id,
  entities: Array.from({ length: entities }, () => sample.entities[0] as never),
});

describe("worlds kept ready [REQ-032]", () => {
  test("a world is identified by its id and digest, and the same blueprint always gives the same identity", () => {
    const a = identityOf(sample);
    expect(a.key).toBe(`${sample.id}@${a.digest}`);
    expect(identityOf(sample)).toEqual(a);
    const renamed = { ...sample, id: "other", name: "다른 이름" };
    expect(identityOf(renamed).digest).toBe(a.digest);
    expect(identityOf(renamed).key).not.toBe(a.key);
  });

  test("a prepared world is shared; the oldest make room when the thread holds too many entities", () => {
    const n = sample.entities.length;
    const cache = new WorldCache(2 * n + 1);
    const prepare = (key: string) => cache.prepare({ key, digest: key }, { ...sample, id: key });
    const first = prepare("k1");
    prepare("k2");
    expect(cache.get("k1")).toBe(first);
    prepare("k3");
    expect([cache.has("k1"), cache.has("k2"), cache.has("k3")]).toEqual([true, false, true]);
    expect(cache.size).toBe(2);
    expect(cache.get("nothing")).toBeUndefined();
  });
});

describe("world versions the control plane read lately [REQ-032]", () => {
  test("concurrent reads of one version share one read; others are read on their own", async () => {
    const cache = new BlueprintCache();
    let reads = 0;
    const load = (bp: typeof sample) => async () => {
      reads++;
      await new Promise((r) => setTimeout(r, 5));
      return bp;
    };
    const [a, b, c] = await Promise.all([
      cache.get("w@1", load(sample)),
      cache.get("w@1", load(sample)),
      cache.get("w@2", load(sample)),
    ]);
    expect([reads, a === b, a === c]).toEqual([2, true, true]);
    await cache.get("w@1", load(sample));
    expect(reads).toBe(2);
  });

  test("a version that does not exist is not remembered, and the oldest are dropped when it is too much", async () => {
    const cache = new BlueprintCache(10);
    expect(await cache.get("gone", async () => undefined)).toBeUndefined();
    expect(cache.size).toBe(0);
    await cache.get("a", async () => sized("a", 6) as never);
    await cache.get("b", async () => sized("b", 6) as never);
    expect(cache.size).toBe(1);
    let reread = 0;
    await cache.get("a", async () => {
      reread++;
      return sized("a", 6) as never;
    });
    expect(reread).toBe(1);
  });
});
