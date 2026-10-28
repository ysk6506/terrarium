import { describe, expect, test } from "vitest";
import { blueprintDigest } from ".";
import { sampleBlueprint } from "./test-support/sample";

describe("world digest [REQ-039]", () => {
  test("copies and renames keep the digest; anything an agent could notice changes it", () => {
    const bp = sampleBlueprint();
    const digest = blueprintDigest(bp);
    expect(digest).toMatch(/^[0-9a-f]{16}$/);
    const copy = {
      ...bp,
      id: "copy",
      name: "복사본",
      meta: { source: "elsewhere" },
      entities: [...bp.entities].reverse(),
    };
    expect(blueprintDigest(copy)).toBe(digest);
    const renamed = {
      ...bp,
      entities: bp.entities.map((e) => (e.id === "srv-a1" ? { ...e, name: "web-01" } : e)),
    };
    expect(blueprintDigest(renamed)).not.toBe(digest);
    expect(blueprintDigest({ ...bp, links: bp.links.slice(1) })).not.toBe(digest);
  });
});
