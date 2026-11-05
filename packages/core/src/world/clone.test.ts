import { Catalog } from "@terrarium/core/catalog";
import { describe, expect, test } from "vitest";
import { cloneState } from "./clone";
import { sampleBlueprint } from "./test-support/sample";
import { World } from "./world";

describe("a copy of the world's state stands on its own [REQ-032] [REQ-037]", () => {
  const worldAfterAWhile = () => {
    const world = World.fromBlueprint(sampleBlueprint(), new Catalog());
    world.patch("srv-a1", "server", { cpuC: 71 });
    world.advance(60);
    return world;
  };

  test("it holds exactly what the original holds", () => {
    const { state } = worldAfterAWhile().snapshot();
    expect(cloneState(state)).toEqual(structuredClone(state));
  });

  test("changing the copy, even inside its lists, leaves the original alone", () => {
    const { state } = worldAfterAWhile().snapshot();
    const before = JSON.stringify(state);
    const copy = cloneState(state);
    copy.t += 1;
    for (const e of Object.values(copy.entities)) {
      e.health = "critical";
      if (e.kind === "server") {
        e.fanRpm[0] = -1;
        e.psuOk.push(false);
      }
    }
    expect(JSON.stringify(state)).toBe(before);
  });

  test("a world that adopts a checkpoint goes on without touching the one it came from", () => {
    const source = worldAfterAWhile();
    const checkpoint = source.checkpoint();
    const before = JSON.stringify(source.snapshot().state);
    const heir = World.fromBlueprint(sampleBlueprint(), new Catalog());
    heir.adopt(checkpoint);
    heir.patch("srv-a1", "server", { cpuC: 99 });
    heir.advance(30);
    expect(JSON.stringify(source.snapshot().state)).toBe(before);
    expect(checkpoint.state.t).toBe(60);
  });
});
