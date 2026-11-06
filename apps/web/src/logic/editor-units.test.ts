/**
 * What people read in the scenario editor besides labels (REQ-071, ADR-0070, ADR-0072): durations in minutes, a fault's
 * duration as a choice, no empty "세부 설정" box, equipment and faults by name, and the timeline in sentences.
 */
import { Catalog } from "@terrarium/core/catalog";
import {
  emptyScenario,
  paletteFor,
  SCENARIO_TEMPLATES,
  validateScenario,
} from "@terrarium/core/scenario";
import { buildTimeline } from "@terrarium/core/session";
import { BlueprintIndex } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { sampleBlueprint } from "../../../../packages/core/src/world/test-support/sample";
import { scenario as sc } from ".";

const index = new BlueprintIndex(sampleBlueprint());
const palette = paletteFor(index);
const item = (key: string) => palette.find((p) => p.key === key) as (typeof palette)[number];
const template = (id: string) =>
  (SCENARIO_TEMPLATES.find((t) => t.id === id) as (typeof SCENARIO_TEMPLATES)[number]).build(
    index,
    "sample",
  );

/** A scenario with one block of a kind, its parameters set. */
function with1(key: string, params: Record<string, number>) {
  let doc = emptyScenario("s", "sample");
  const added = sc.addBlock(doc, item(key), { x: 0, y: 0 });
  doc = added.doc;
  for (const [name, value] of Object.entries(params))
    doc = sc.setParam(doc, added.nodeId, name, value);
  return { doc, id: added.nodeId };
}

const field = (doc: ReturnType<typeof with1>["doc"], id: string, name: string) =>
  sc.fieldsOf(doc, id, index).find((f) => f.name === name);

describe("durations are minutes wherever people read them [REQ-071]", () => {
  test("the form shows minutes, steps by one, and stores seconds", () => {
    const { doc, id } = with1("wait", { seconds: 300 });
    const f = field(doc, id, "seconds");
    expect(f).toMatchObject({
      control: "number",
      unit: "분",
      value: 5,
      step: 1,
      stored: "seconds",
    });
    if (f?.control !== "number") throw new Error("a number field");
    expect(sc.storedNumber(f, 7)).toBe(420);
    expect(sc.storedNumber({}, 7)).toBe(7);
    expect(sc.storedNumber(f, undefined)).toBeUndefined();
    expect(sc.readNumber("2.5", f)).toBe(3);
  });

  test("a value that is not a whole number of minutes shows one decimal and allows tenths", () => {
    const { doc, id } = with1("wait", { seconds: 90 });
    const f = field(doc, id, "seconds");
    expect(f).toMatchObject({ control: "number", unit: "분", value: 1.5, step: 0.1 });
    if (f?.control !== "number") throw new Error("a number field");
    expect(sc.readNumber("2.5", f)).toBe(2.5);
    expect(sc.storedNumber(f, 2.5)).toBe(150);
  });

  test("the agent's time limit and a condition wait's timeout are minutes too", () => {
    const agent = with1("agent_task", { timeLimitSeconds: 3600 });
    expect(field(agent.doc, agent.id, "timeLimitSeconds")).toMatchObject({
      unit: "분",
      value: 60,
      min: 1,
      max: 5760,
    });
    const until = with1("wait_until", { timeoutSeconds: 1800 });
    expect(field(until.doc, until.id, "timeoutSeconds")).toMatchObject({ unit: "분", value: 30 });
  });

  test("canvas summaries and dry-run lines say minutes", () => {
    const n = (type: string, params: Record<string, unknown>) =>
      sc.summaryOf({ id: "n", type, params: params as never, position: { x: 0, y: 0 } }, index);
    expect(n("wait", { seconds: 300 })).toBe("5분 기다려요");
    expect(n("wait", { seconds: 90 })).toBe("1.5분 기다려요");
    expect(n("agent_task", { maxToolCalls: 40, timeLimitSeconds: 3600 })).toBe(
      "툴 40회, 60분 안에",
    );
    const doc = template("cooling-failure");
    const wait = {
      t: 10,
      tool: "wait",
      args: { seconds: 600 },
      ok: true,
    } as never;
    const line = buildTimeline(doc, [], [], [wait], 0)[0]?.text;
    expect(line).toBe("10분 기다려요");
  });

  test("a validation message about a duration says minutes", () => {
    const { doc } = with1("wait", { seconds: 0 });
    const issues = validateScenario(doc, { index, catalog: new Catalog() });
    const range = issues.find((i) => i.param === "seconds")?.message ?? "";
    expect(range).toContain("분 사이여야 해요");
    expect(range).not.toContain("초");
  });
});

describe("how long a fault lasts is a choice [REQ-071]", () => {
  test("0 reads '고쳐질 때까지'; a number of minutes reads '저절로 복구' and shows the minutes", () => {
    const until = with1("inject_fault:cooling_unit_failure", { durationSeconds: 0 });
    expect(field(until.doc, until.id, "durationSeconds")).toMatchObject({
      control: "recovery",
      label: "복구 방식",
      mode: "until_fixed",
      choices: [
        { value: "until_fixed", label: "고쳐질 때까지" },
        { value: "timed", label: "n분 뒤 저절로 복구" },
      ],
    });
    const timed = with1("inject_fault:cooling_unit_failure", { durationSeconds: 900 });
    expect(field(timed.doc, timed.id, "durationSeconds")).toMatchObject({
      mode: "timed",
      minutes: { value: 15, step: 1, min: 1, max: 1440 },
    });
  });

  test("picking a mode stores seconds: 0, or the minutes it had, or ten minutes at first", () => {
    expect(sc.recoverySeconds("until_fixed", 900)).toBe(0);
    expect(sc.recoverySeconds("timed", 900)).toBe(900);
    expect(sc.recoverySeconds("timed", 0)).toBe(sc.DEFAULT_TIMED_SECONDS);
    expect(sc.recoverySeconds("timed", undefined)).toBe(600);
    const { doc, id } = with1("inject_fault:cooling_unit_failure", {});
    const picked = sc.setParam(doc, id, "durationSeconds", sc.recoverySeconds("timed", undefined));
    expect(field(picked, id, "durationSeconds")).toMatchObject({
      mode: "timed",
      minutes: { value: 10 },
    });
    const back = sc.setParam(picked, id, "durationSeconds", sc.recoverySeconds("until_fixed", 600));
    expect(field(back, id, "durationSeconds")).toMatchObject({ mode: "until_fixed" });
  });
});

describe("an empty details box is not shown [REQ-071]", () => {
  test("a fault with nothing to set has no '세부 설정'; one with settings has", () => {
    const none = with1("inject_fault:cooling_unit_failure", {});
    expect(sc.fieldsOf(none.doc, none.id, index).map((f) => f.name)).toEqual([
      "faultType",
      "target",
      "durationSeconds",
    ]);
    const some = with1("inject_fault:sensor_drift", {});
    const details = field(some.doc, some.id, "faultParams");
    expect(details).toMatchObject({ control: "numbers", label: "세부 설정" });
  });
});

describe("the sheet's footer and the timeline use names, not codes [REQ-071]", () => {
  test("equipment by name, faults by label, conditions as sentences", () => {
    const doc = template("cooling-failure");
    const diagnosis = doc.expectations.find((e) => e.kind === "diagnosis");
    if (diagnosis?.kind !== "diagnosis") throw new Error("a diagnosis");
    const text = sc.expectationText(diagnosis, index);
    expect(text).toContain("냉방기 정지");
    expect(text).not.toMatch(/cooling_unit_failure/);
    const unit = diagnosis.rootCause[0] as string;
    expect(text).toContain(index.find(unit)?.name as string);
    expect(
      sc.expectationText(
        { id: "a", kind: "required_action", action: "restart", target: unit, weight: 1 },
        index,
      ),
    ).toBe(`재시작 (${index.find(unit)?.name})`);
    expect(
      sc.expectationText(
        { id: "f", kind: "final_state", condition: { kind: "diagnosis_submitted" }, weight: 1 },
        index,
      ),
    ).toBe("에이전트가 진단을 제출했어요");
    expect(
      sc.expectationText({ id: "t", kind: "time_limit", seconds: 1800, weight: 1 }, index),
    ).toBe("30분 안에");
  });

  test("a wait does not say its name twice, and a fault is told by its label and name", () => {
    const doc = template("cooling-failure");
    const wait = doc.nodes.find((n) => n.type === "wait");
    const fault = doc.nodes.find((n) => n.type === "inject_fault");
    if (!wait || !fault) throw new Error("a wait and a fault");
    const name = (id: string) => index.find(id)?.name ?? id;
    const lines = buildTimeline(
      doc,
      [
        { t: 0, nodeId: fault.id, what: "ran" },
        { t: 0, nodeId: wait.id, what: "waiting" },
        { t: 600, nodeId: wait.id, what: "resumed" },
        { t: 700, nodeId: fault.id, what: "expired", detail: "f-1" },
      ],
      [],
      [],
      0,
      name,
    ).map((l) => l.text);
    expect(lines[0]).toBe(`냉방기 정지 발생 (${name(String(fault.params.target))})`);
    expect(lines[1]).toBe("대기 시작");
    expect(lines[2]).toBe("대기 끝");
    expect(lines[3]).toContain("고장 자동 복구");
    expect(lines[3]).not.toContain("f-1");
  });
});
