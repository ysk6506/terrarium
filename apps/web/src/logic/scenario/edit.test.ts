/**
 * The editor's everyday edits and its words (REQ-034, REQ-071, beta feedback 18 to 21): a new block goes right after the
 * selected one, copies and duplicates keep the line a line, the palette is three questions, and the sheet reads as
 * sentences.
 */
import { Catalog } from "@terrarium/core/catalog";
import { emptyScenario, paletteFor, validateScenario } from "@terrarium/core/scenario";
import { BlueprintIndex } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { campusBlueprint } from "../../../../../packages/core/src/world/test-support/sample-campus";
import { scenario as sc } from "..";

const index = new BlueprintIndex(campusBlueprint());
const palette = paletteFor(index);
const item = (key: string) => palette.find((p) => p.key === key) as (typeof palette)[number];
const order = (doc: ReturnType<typeof emptyScenario>): string[] => {
  const out: string[] = [];
  let at = doc.nodes.find((n) => n.type === "start");
  while (at) {
    out.push(at.type);
    const wire = doc.edges.find((e) => e.from === at?.id);
    at = wire && doc.nodes.find((n) => n.id === wire.to);
  }
  return out;
};
const line = () => {
  let doc = emptyScenario("s", "campus");
  for (const key of ["wait", "agent_task"]) doc = sc.appendBlock(doc, item(key)).doc;
  return doc;
};

describe("a new block goes right after the selected block [REQ-034] [REQ-071]", () => {
  test("between two blocks: the old next block follows the new one", () => {
    const doc = line();
    const wait = doc.nodes.find((n) => n.type === "wait");
    const r = sc.insertBlock(doc, item("note"), wait?.id);
    expect(order(r.doc)).toEqual(["start", "wait", "note", "agent_task"]);
    expect(r.doc.nodes.find((n) => n.id === r.nodeId)?.position.y).toBeGreaterThan(
      wait?.position.y ?? 0,
    );
  });

  test("with nothing selected it goes to the end of the line, as before", () => {
    expect(order(sc.insertBlock(line(), item("note")).doc)).toEqual([
      "start",
      "wait",
      "agent_task",
      "note",
    ]);
  });

  test("after the start block it becomes the first block of the line", () => {
    const r = sc.insertBlock(line(), item("note"), "start");
    expect(order(r.doc)).toEqual(["start", "note", "wait", "agent_task"]);
  });

  test("blocks lower on the canvas move down to make room", () => {
    const doc = line();
    const before = doc.nodes.find((n) => n.type === "agent_task")?.position.y ?? 0;
    const r = sc.insertBlock(doc, item("note"), "start");
    expect(r.doc.nodes.find((n) => n.type === "agent_task")?.position.y).toBeGreaterThan(before);
  });
});

describe("copy, paste, duplicate and delete keep the line a line [REQ-034] [REQ-071]", () => {
  test("duplicating a block puts a copy right after it, with its own id and the same settings", () => {
    const doc = line();
    const wait = doc.nodes.find((n) => n.type === "wait");
    const r = sc.duplicateNode(doc, wait?.id ?? "");
    expect(order(r.doc)).toEqual(["start", "wait", "wait", "agent_task"]);
    const copy = r.doc.nodes.find((n) => n.id === r.nodeIds[0]);
    expect(copy?.id).not.toBe(wait?.id);
    expect(copy?.params).toEqual(wait?.params);
    expect(copy?.params).not.toBe(wait?.params);
  });

  test("the start block cannot be copied", () => {
    expect(sc.copyNodes(line(), ["start"])).toBeUndefined();
    expect(() => sc.duplicateNode(line(), "start")).toThrow(/시작 블록/);
  });

  test("a block that may appear once cannot be pasted a second time, and the message says so", () => {
    const doc = line();
    const agent = doc.nodes.find((n) => n.type === "agent_task");
    expect(() => sc.duplicateNode(doc, agent?.id ?? "")).toThrow(/까지만 둘 수 있어서/);
  });

  test("several blocks pasted keep the wires between them and wire to nothing else", () => {
    const doc = line();
    const snippet = sc.copyNodes(
      doc,
      doc.nodes.filter((n) => n.type !== "start").map((n) => n.id),
    );
    const base = { ...doc, nodes: doc.nodes.filter((n) => n.type !== "agent_task") };
    const small = { ...base, edges: [] };
    const r = sc.pasteSnippet(small, snippet ?? { nodes: [], edges: [] });
    expect(r.nodeIds).toHaveLength(2);
    expect(new Set(r.doc.nodes.map((n) => n.id)).size).toBe(r.doc.nodes.length);
    expect(r.doc.edges).toHaveLength(1);
  });

  test("deleting a block in the middle joins its neighbours", () => {
    const doc = sc.insertBlock(line(), item("note"), "start").doc;
    const note = doc.nodes.find((n) => n.type === "note");
    const mended = sc.removeAndMend(doc, note?.id ?? "");
    expect(order(mended)).toEqual(["start", "wait", "agent_task"]);
    expect(sc.removeAndMend(doc, "start")).toBe(doc);
  });

  test("the editor still finds nothing unconnected after an insert", () => {
    const catalog = new Catalog();
    const r = sc.insertBlock(line(), item("note"), "start");
    const issues = validateScenario(r.doc, { index, catalog });
    expect(issues.filter((i) => i.code === "SC009" || i.code === "SC010")).toEqual([]);
  });
});

describe("the palette is three questions [REQ-071]", () => {
  test("their names, and where the first open one is", () => {
    expect(sc.QUESTIONS.map((q) => q.title)).toEqual([
      "어디가 고장 나나요",
      "에이전트가 뭘 하면 되나요",
      "어떻게 채점하나요",
    ]);
    expect(sc.firstOpen(emptyScenario("s", "campus"))).toBe("fault");
    expect(sc.firstOpen(line())).toBe("fault");
  });

  test("a question shows a few common blocks and keeps the rest behind more", () => {
    const fault = sc.entriesOf("fault", palette);
    expect(fault.common.length).toBeGreaterThanOrEqual(4);
    expect(fault.common.length).toBeLessThanOrEqual(6);
    expect(fault.more.length).toBeGreaterThan(10);
    expect(new Set([...fault.common, ...fault.more].map((e) => e.key)).size).toBe(
      fault.common.length + fault.more.length,
    );
    const task = sc.entriesOf("task", palette);
    expect(task.common.map((e) => e.key)).toContain("agent_task");
  });

  test("every block of the flow answers exactly one question", () => {
    const all = [...sc.entriesOf("fault", palette).common, ...sc.entriesOf("fault", palette).more]
      .concat(sc.entriesOf("task", palette).common, sc.entriesOf("task", palette).more)
      .filter((e) => e.kind === "block");
    expect(all).toHaveLength(palette.length);
  });

  test("the third question is the scoring lines, and the search looks across all three", () => {
    expect(sc.entriesOf("score", palette).common.map((e) => e.key)).toContain("score:diagnosis");
    expect(sc.searchEntries(palette, "냉방기").some((e) => e.kind === "block")).toBe(true);
    expect(sc.searchEntries(palette, "툴 호출").some((e) => e.kind === "score")).toBe(true);
    expect(sc.searchEntries(palette, "  ")).toEqual([]);
  });
});

describe("the sheet reads as sentences [REQ-034] [REQ-071]", () => {
  const withFault = () => {
    const target = index.ofKind("cooling_unit")[0]?.id ?? "";
    let doc = sc.appendBlock(line(), {
      ...item("inject_fault:cooling_unit_failure"),
      params: { faultType: "cooling_unit_failure", target },
    }).doc;
    doc = sc.addScoreLine(doc, "diagnosis").doc;
    return { doc, target };
  };

  test("a new diagnosis line is filled from the fault blocks and says so", () => {
    const { doc, target } = withFault();
    const x = doc.expectations[0];
    expect(x).toMatchObject({
      kind: "diagnosis",
      rootCause: [target],
      faultType: ["cooling_unit_failure"],
    });
    const s = sc.sentenceOf(x as never, doc, index);
    expect(s.source).toBe("고장 블록에서 저절로");
    expect(s.tokens[0]).toMatchObject({ kind: "number", field: "weight", value: 60 });
  });

  test("a line that no longer matches the fault blocks loses the word 저절로 and can be refilled", () => {
    const { doc } = withFault();
    const edited = sc.updateExpectation(doc, "x1", { rootCause: [] });
    expect(sc.sentenceOf(edited.expectations[0] as never, edited, index).source).toBeUndefined();
    expect(sc.fillAnswer(edited, "x1").expectations[0]).toEqual(doc.expectations[0]);
  });

  test("a penalty line shows the minus sign and the action by name", () => {
    const doc = sc.addScoreLine(line(), "forbidden_action").doc;
    const s = sc.sentenceOf(doc.expectations[0] as never, doc, index);
    expect(s.tone).toBe("lose");
    expect(s.tokens[0]).toEqual({ kind: "text", text: "−" });
    expect(s.tokens.some((t) => t.kind === "word" && t.text === "전원 끄기")).toBe(true);
  });

  test("minutes and call counts are numbers inside the sentence", () => {
    let doc = sc.addScoreLine(line(), "time_limit").doc;
    doc = sc.addScoreLine(doc, "tool_budget").doc;
    const fields = doc.expectations.flatMap((x) =>
      sc.sentenceOf(x, doc, index).tokens.flatMap((t) => (t.kind === "number" ? [t.field] : [])),
    );
    expect(fields).toEqual(["weight", "minutes", "weight", "maxCalls"]);
  });

  test("the pass rule is the one the core scores by, and recovery and runbook are said in words", () => {
    expect(sc.passSentence()).toMatch(/^진단을 맞히고 \d+점 이상이면 합격이에요$/);
    expect(sc.scoringNotes(line())).toEqual([]);
    const notes = sc.scoringNotes({ ...line(), scoring: "recovery" });
    expect(notes[0]).toMatch(/복구 시간 35점.*복구 순서 15점/);
    expect(notes.join("")).not.toMatch(/장애|[a-z]+_[a-z]+/);
  });
});
