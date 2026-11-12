import { NotFoundError } from "@terrarium/core/kernel";
import { describe, expect, test } from "vitest";
import {
  type AgentHistory,
  addManual,
  changesOf,
  diffSnapshots,
  editVersion,
  labelOf,
  newest,
  observe,
  pendingChange,
  removeVersion,
  snapshotOf,
} from "./agent-version";
import type { Subject } from "./model";

const KEY = { harnessId: "h1", agentId: "triage" };
const DAY1 = "2026-10-01T09:00:00.000Z";
const DAY2 = "2026-10-05T09:00:00.000Z";
const DAY3 = "2026-10-09T09:00:00.000Z";

const subject = (
  agent: Partial<Subject["agent"]> = {},
  metadata?: Subject["harness"]["metadata"],
) =>
  ({
    harness: {
      id: "h1",
      name: "회사 하네스",
      kind: "http",
      toolTransport: "mcp",
      ...(metadata ? { metadata } : {}),
    },
    agent: { id: "triage", name: "분류", ...agent },
  }) satisfies Subject;

describe("what an agent says about itself, as one flat record [REQ-053]", () => {
  test("fields it did not report are left out; facts and the connection's metadata get their own keys", () => {
    expect(snapshotOf(subject())).toEqual({
      name: "분류",
      "harness.kind": "http",
      "harness.name": "회사 하네스",
      "harness.toolTransport": "mcp",
    });
    expect(
      snapshotOf(
        subject(
          { model: "m-1", description: "알람 분류", facts: { graph: "triage" } },
          { team: "platform" },
        ),
      ),
    ).toEqual({
      name: "분류",
      description: "알람 분류",
      model: "m-1",
      "harness.kind": "http",
      "harness.name": "회사 하네스",
      "harness.toolTransport": "mcp",
      "fact.graph": "triage",
      "harness.meta.team": "platform",
    });
  });

  test("a difference is said in words: changed, added, removed; the usual fields first", () => {
    const before = snapshotOf(subject({ model: "m-1", facts: { graph: "a", mode: "x" } }));
    const after = snapshotOf(subject({ model: "m-2", facts: { graph: "b", extra: "1" } }));
    expect(diffSnapshots(before, after)).toEqual([
      { field: "model", label: "모델", before: "m-1", after: "m-2" },
      { field: "fact.extra", label: "하네스가 알려 준 사실 extra", after: "1" },
      { field: "fact.graph", label: "하네스가 알려 준 사실 graph", before: "a", after: "b" },
      { field: "fact.mode", label: "하네스가 알려 준 사실 mode", before: "x" },
    ]);
    expect(diffSnapshots(before, before)).toEqual([]);
    expect(labelOf("harness.meta.team")).toBe("연결 메타데이터 team");
    expect(labelOf("attr.prompt")).toBe("속성 prompt");
    expect(labelOf("something.else")).toBe("something.else");
    expect(labelOf("harness.kind")).toBe("하네스 종류");
  });
});

describe("a version is written only when the agent differs from the newest [REQ-053]", () => {
  test("the first look writes version 1; the same agent again writes nothing", () => {
    const first = observe(undefined, KEY, snapshotOf(subject()), DAY1, "haneul");
    expect(first.created).toBe(true);
    expect(first.version).toMatchObject({
      n: 1,
      at: DAY1,
      source: "auto",
      by: "haneul",
      attributes: {},
    });
    expect(first.history).toMatchObject({ ...KEY, next: 2 });
    expect(changesOf(first.history, 1)).toEqual([]);
    const again = observe(first.history, KEY, snapshotOf(subject()), DAY2, "jimin");
    expect(again.created).toBe(false);
    expect(again.version.n).toBe(1);
    expect(again.history).toBe(first.history);
  });

  test("a changed agent gets the next number, the date and what changed", () => {
    const v1 = observe(undefined, KEY, snapshotOf(subject({ model: "m-1" })), DAY1, "haneul");
    const v2 = observe(v1.history, KEY, snapshotOf(subject({ model: "m-2" })), DAY2, "jimin");
    expect(v2.created).toBe(true);
    expect(v2.version).toMatchObject({ n: 2, at: DAY2, by: "jimin" });
    expect(changesOf(v2.history, 2)).toEqual([
      { field: "model", label: "모델", before: "m-1", after: "m-2" },
    ]);
    expect(newest(v2.history)?.n).toBe(2);
    // Back to the old value is a change again, not a return to version 1.
    const v3 = observe(v2.history, KEY, snapshotOf(subject({ model: "m-1" })), DAY3);
    expect(v3.version.n).toBe(3);
    expect(v3.version.by).toBeUndefined();
  });

  test("looking without writing: what the next experiment would add", () => {
    expect(pendingChange(undefined, snapshotOf(subject()))).toEqual({ first: true, changes: [] });
    const v1 = observe(undefined, KEY, snapshotOf(subject({ model: "m-1" })), DAY1).history;
    expect(pendingChange(v1, snapshotOf(subject({ model: "m-1" })))).toBeUndefined();
    expect(pendingChange(v1, snapshotOf(subject({ model: "m-2" })))).toEqual({
      first: false,
      changes: [{ field: "model", label: "모델", before: "m-1", after: "m-2" }],
    });
  });
});

describe("people add, change and delete versions [REQ-053]", () => {
  const start = (): AgentHistory =>
    observe(undefined, KEY, snapshotOf(subject({ model: "m-1" })), DAY1, "haneul").history;

  test("a version a person adds copies the newest snapshot and says what they know; the attributes show up as changes", () => {
    const added = addManual(start(), KEY, {}, DAY2, "jimin", {
      label: "프롬프트 v2",
      note: "시스템 프롬프트에 규칙 추가",
      attributes: { prompt: "v2" },
    });
    expect(added.version).toMatchObject({
      n: 2,
      source: "manual",
      by: "jimin",
      label: "프롬프트 v2",
      snapshot: { model: "m-1" },
      attributes: { prompt: "v2" },
    });
    expect(changesOf(added.history, 2)).toEqual([
      { field: "attr.prompt", label: "속성 prompt", after: "v2" },
    ]);
    // Looking at the same agent afterwards adds nothing, and a real change keeps what people said.
    expect(observe(added.history, KEY, snapshotOf(subject({ model: "m-1" })), DAY3).created).toBe(
      false,
    );
    const next = observe(added.history, KEY, snapshotOf(subject({ model: "m-9" })), DAY3);
    expect(next.version.attributes).toEqual({ prompt: "v2" });
    expect(changesOf(next.history, 3)).toEqual([
      { field: "model", label: "모델", before: "m-1", after: "m-9" },
    ]);
  });

  test("the first version can be a person's, and its attributes are the person's alone", () => {
    const snap = snapshotOf(subject());
    const first = addManual(undefined, KEY, snap, DAY1, "haneul", {});
    expect(first.version).toMatchObject({ n: 1, snapshot: snap, attributes: {} });
    expect(first.version.label).toBeUndefined();
    const second = addManual(first.history, KEY, snap, DAY2, "haneul", { attributes: { a: "1" } });
    const third = addManual(second.history, KEY, snap, DAY3, "haneul", {});
    expect(third.version.attributes).toEqual({ a: "1" });
  });

  test("naming, noting and re-tagging leave what was observed alone; null takes a name or note away", () => {
    const history = addManual(start(), KEY, {}, DAY2, "jimin", { label: "a", note: "b" }).history;
    const edited = editVersion(history, 2, { label: "새 이름", attributes: { k: "v" } });
    expect(edited.versions.find((v) => v.n === 2)).toMatchObject({
      label: "새 이름",
      note: "b",
      attributes: { k: "v" },
      at: DAY2,
      snapshot: { model: "m-1" },
    });
    const bare = editVersion(edited, 2, { label: null, note: null });
    const v = bare.versions.find((x) => x.n === 2);
    expect(v?.label).toBeUndefined();
    expect(v?.note).toBeUndefined();
    expect(() => editVersion(history, 9, { label: "x" })).toThrow(NotFoundError);
  });

  test("a deleted version leaves its number unused, and the next one is compared with what is left", () => {
    let history = start();
    history = observe(history, KEY, snapshotOf(subject({ model: "m-2" })), DAY2).history;
    history = observe(history, KEY, snapshotOf(subject({ model: "m-3" })), DAY3).history;
    const cut = removeVersion(history, 2);
    expect(cut.versions.map((v) => v.n)).toEqual([1, 3]);
    expect(cut.next).toBe(4);
    expect(changesOf(cut, 3)).toEqual([
      { field: "model", label: "모델", before: "m-1", after: "m-3" },
    ]);
    expect(changesOf(cut, 2)).toEqual([]);
    expect(() => removeVersion(cut, 2)).toThrow(NotFoundError);
    // Delete everything: the next look starts again, but not at 1.
    const empty = removeVersion(removeVersion(cut, 1), 3);
    expect(newest(empty)).toBeUndefined();
    const again = observe(empty, KEY, snapshotOf(subject({ model: "m-3" })), DAY3);
    expect(again.version.n).toBe(4);
  });
});
