import { Catalog } from "@terrarium/core/catalog";
import { InvalidValueError } from "@terrarium/core/kernel";
import { describe, expect, test } from "vitest";
import { blueprintDigest, prepareWorld, World } from ".";
import { sampleBlueprint } from "./test-support/sample";

const catalog = new Catalog();

describe("a blueprint checked and indexed once, shared by the worlds built on it [REQ-032]", () => {
  test("worlds built on one prepared blueprint share its index and nothing else", () => {
    const prepared = prepareWorld(sampleBlueprint(), catalog);
    const a = World.fromPrepared(prepared, catalog);
    const b = World.fromPrepared(prepared, catalog);
    expect(a.index).toBe(b.index);
    expect(prepared.digest).toBe(blueprintDigest(prepared.blueprint));

    a.advance(100);
    a.apply({ type: "power.set", target: "srv-a1", on: false }, "test");
    expect(b.time()).toBe(0);
    expect(b.events()).toEqual([]);
    expect(b.stateAs("srv-a1", "server").adminOn).toBe(true);
  });

  test("a world made from the prepared blueprint starts exactly where fromBlueprint's does", () => {
    const blueprint = sampleBlueprint();
    const own = World.fromBlueprint(blueprint, catalog);
    const shared = World.fromPrepared(prepareWorld(blueprint, catalog), catalog);
    expect(shared.snapshot()).toEqual(own.snapshot());
  });

  test("an invalid blueprint is refused with the same reasons, and a given digest is trusted", () => {
    const broken = sampleBlueprint();
    const bad = {
      ...broken,
      links: [...broken.links, { ...(broken.links[0] as object), id: "l-x", to: "nope" }],
    };
    expect(() => prepareWorld(bad as never, catalog)).toThrow(InvalidValueError);
    expect(() => World.fromBlueprint(bad as never, catalog)).toThrow(/is invalid/);
    expect(prepareWorld(sampleBlueprint(), catalog, "given").digest).toBe("given");
  });
});
