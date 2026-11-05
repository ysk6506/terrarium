/**
 * Pressing blocks in the palette builds a scenario that already runs (REQ-034, REQ-070): each new block is wired
 * after the end of the main line, so an author who presses 장애, 대기, 에이전트 투입 has nothing left to connect.
 */

import { Catalog } from "@terrarium/core/catalog";
import { emptyScenario, paletteFor, validateScenario } from "@terrarium/core/scenario";
import { BlueprintIndex } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { sampleBlueprint } from "../../../../packages/core/src/world/test-support/sample";
import { campusBlueprint } from "../../../../packages/core/src/world/test-support/sample-campus";
import { scenario as sc } from ".";

const index = new BlueprintIndex(campusBlueprint());
const palette = paletteFor(index);
const item = (key: string) => palette.find((p) => p.key === key) as (typeof palette)[number];
const catalog = new Catalog();

function blank() {
  // the editor starts a blank scenario with the start block only
  const doc = emptyScenario("s", "campus");
  return doc.nodes.some((n) => n.type === "start")
    ? doc
    : sc.addBlock(doc, item("start"), { x: 0, y: 0 }).doc;
}

describe("pressing a block wires it after the end of the main line [REQ-034] [REQ-070]", () => {
  test("press wait and the agent: the line is start, wait, agent, with nothing left unconnected", () => {
    let doc = blank();
    for (const key of ["wait", "agent_task"]) doc = sc.appendBlock(doc, item(key)).doc;
    const order: string[] = [];
    let at = doc.nodes.find((n) => n.type === "start");
    while (at) {
      order.push(at.type);
      const wire = doc.edges.find((e) => e.from === at?.id);
      at = wire && doc.nodes.find((n) => n.id === wire.to);
    }
    expect(order).toEqual(["start", "wait", "agent_task"]);
    const issues = validateScenario(doc, { index, catalog });
    expect(issues.filter((i) => i.code === "SC009" || i.code === "SC010")).toEqual([]);
    expect(sc.lineEnd(doc)?.type).toBe("agent_task");
  });

  test("a fault block pressed first joins the line, and is the end the next block follows", () => {
    const fault = palette.find(
      (p) => p.available && p.category === "fault",
    ) as (typeof palette)[number];
    const { doc, nodeId } = sc.appendBlock(blank(), fault);
    expect(doc.edges).toHaveLength(1);
    expect(sc.lineEnd(doc)?.id).toBe(nodeId);
  });

  test("dragging onto the canvas still leaves the block where it was dropped, unwired", () => {
    const start = blank();
    const { doc } = sc.addBlock(start, item("wait"), { x: 400, y: 400 });
    expect(doc.edges).toEqual(start.edges);
  });

  test("after a block with two exits there is no single end, so nothing is wired for the author", () => {
    let doc = sc.appendBlock(blank(), item("branch")).doc;
    expect(sc.lineEnd(doc)).toBeUndefined();
    const before = doc.edges.length;
    doc = sc.appendBlock(doc, item("wait")).doc;
    expect(doc.edges.length).toBe(before);
  });

  test("a block that cannot be used in this world says why, and changes nothing", () => {
    const bare = paletteFor(new BlueprintIndex(sampleBlueprint()));
    const unusable = bare.find((p) => !p.available);
    expect(unusable, "the small sample world has blocks it cannot use").toBeDefined();
    const doc = blank();
    expect(() => sc.appendBlock(doc, unusable as (typeof bare)[number])).toThrow(sc.FlowError);
  });
});
