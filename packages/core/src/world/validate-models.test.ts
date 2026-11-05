import { Catalog } from "@terrarium/core/catalog";
import { describe, expect, test } from "vitest";
import { type Entity, validateBlueprint } from ".";
import { sampleBlueprint, withChanges } from "./test-support/sample";

const catalog = new Catalog();
const base = sampleBlueprint();
const server = base.entities.find((x) => x.id === "srv-a1") as Entity;
const rack = base.entities.find((x) => x.id === "rack-a") as Entity;
const messages = (changed: Entity[]) =>
  validateBlueprint(withChanges(base, { entities: changed }), catalog)
    .filter((i) => i.code === "W006")
    .map((i) => i.message);

describe("equipment must name a model that is in the catalog and is for its kind [REQ-001]", () => {
  test("the sample world is fine as it is", () => {
    expect(validateBlueprint(base, catalog).filter((i) => i.code === "W006")).toEqual([]);
  });

  test("a server with no model at all is told so, and so is one whose model is not in the catalog", () => {
    const { modelId: _drop, ...bare } = server;
    expect(messages([bare])).toEqual([expect.stringContaining("찾을 수 없어요")]);
    expect(messages([{ ...server, modelId: "no-such-model" }])).toEqual([
      expect.stringContaining("'no-such-model'"),
    ]);
  });

  test("a model for another kind of equipment is told apart from a missing one", () => {
    const switchModel = base.entities.find((x) => x.id === "tor-a")?.modelId as string;
    const out = messages([{ ...server, modelId: switchModel }]);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("용이에요");
  });

  test("a rack is checked only when it names a model", () => {
    const { modelId: _none, ...plain } = rack;
    expect(messages([plain])).toEqual([]);
    expect(messages([{ ...rack, modelId: "no-such-rack" }])).toHaveLength(1);
  });
});
