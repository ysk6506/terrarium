/**
 * The first scenario a person makes, start to finish, without drawing a single wire or typing an id (REQ-071):
 * press 고장, 대기, 에이전트 투입, pick what breaks from the list, say what the right answer is, and the scenario
 * is valid, runs, and the check on the exam paper tells an agent that knows from one that does not.
 */
import { Catalog } from "@terrarium/core/catalog";
import {
  emptyScenario,
  hasErrors,
  type PaletteItem,
  paletteFor,
  type ScenarioDoc,
  validateScenario,
} from "@terrarium/core/scenario";
import { calibrate } from "@terrarium/core/session";
import { BlueprintIndex } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { campusBlueprint } from "../../../../packages/core/src/world/test-support/sample-campus";
import { scenario as sc } from ".";

const blueprint = campusBlueprint();
const index = new BlueprintIndex(blueprint);
const palette = paletteFor(index);
const catalog = new Catalog();

const press = (doc: ScenarioDoc, item: PaletteItem | undefined) => {
  if (!item) throw new Error("the block is not in the palette");
  return sc.appendBlock(doc, item);
};
const byKey = (key: string) => palette.find((p) => p.key === key);
const unit = index.ofKind("cooling_unit")[0]?.id ?? "";

/** A person's scenario: blocks pressed in order, one pick, one sentence, one answer. */
function made() {
  // a blank scenario from the editor already has its start block
  let doc = emptyScenario("s-new", "campus");
  const fault = palette.find(
    (p) => p.available && p.category === "fault" && p.params?.faultType === "cooling_unit_failure",
  );
  const pressedFault = press(doc, fault);
  doc = sc.setParam(pressedFault.doc, pressedFault.nodeId, "target", unit);
  doc = press(doc, byKey("wait")).doc;
  const agent = press(doc, byKey("agent_task"));
  doc = sc.setParam(agent.doc, agent.nodeId, "prompt", "서버룸 온도 알람이 이어지고 있어요.");
  const added = sc.addExpectation(doc, "diagnosis");
  return sc.updateExpectation(added.doc, added.id, {
    rootCause: [unit],
    faultType: ["cooling_unit_failure"],
    weight: 100,
  });
}

describe("the first scenario, made only by pressing blocks and picking [REQ-071] [REQ-070] [REQ-034]", () => {
  test("it is valid: nothing left unconnected, nothing left to fix", () => {
    const doc = made();
    const issues = validateScenario(doc, { index, catalog });
    expect(hasErrors(issues), issues.map((i) => i.message).join(" / ")).toBe(false);
    expect(issues.filter((i) => i.code === "SC009" || i.code === "SC010")).toEqual([]);
    expect(doc.edges).toHaveLength(3);
  });

  test("the check on the exam paper runs it and tells knowing from not knowing", () => {
    const result = calibrate({ blueprint, scenario: made() });
    const total = (id: string) => result.runs.find((r) => r.id === id)?.total;
    expect(total("knows")).toBe(100);
    expect(total("idle")).toBe(0);
    expect(total("guess")).toBe(0);
    expect(result.runs.find((r) => r.id === "knows")?.passed).toBe(true);
    // a paper that scores only the diagnosis says so, and where to fix it
    expect(result.warnings.join(" ")).toContain("정답만 말하면 만점");
  });

  test("after 조치 항목 더하기, the agent that only knows the answer no longer gets full marks [REQ-071] [REQ-070]", () => {
    const before = made();
    const added = sc.suggestedAction(before, index);
    // a cooling unit that stops is answered at the setpoint: the card asks for that action, on that unit
    expect(added.kind).toBe("required_action");
    expect(added.doc.expectations.find((x) => x.id === added.id)).toMatchObject({
      kind: "required_action",
      action: "setpoint_change",
      target: unit,
      weight: 20,
    });
    const issues = validateScenario(added.doc, { index, catalog });
    expect(hasErrors(issues), issues.map((i) => i.message).join(" / ")).toBe(false);
    const total = (doc: ScenarioDoc, id: string) =>
      calibrate({ blueprint, scenario: doc }).runs.find((r) => r.id === id)?.total;
    expect(total(before, "knows")).toBe(100);
    expect(total(added.doc, "knows")).toBeLessThan(100);
    expect(total(added.doc, "idle")).toBe(0);
  });

  test("a fault nothing remote can fix gets an empty end-state card to describe instead [REQ-071]", () => {
    let doc = emptyScenario("s-new", "campus");
    const drift = palette.find(
      (p) => p.available && p.category === "fault" && p.params?.faultType === "sensor_drift",
    );
    const pressed = press(doc, drift);
    doc = pressed.doc;
    const added = sc.suggestedAction(doc, index);
    expect(added.kind).toBe("final_state");
    expect(added.doc.expectations.find((x) => x.id === added.id)).toMatchObject({
      kind: "final_state",
      weight: 20,
    });
    expect(added.doc.expectations.find((x) => x.id === added.id)).not.toHaveProperty("label");
    // a scenario with no fault at all gets the same card
    expect(sc.suggestedAction(emptyScenario("s", "campus"), index).kind).toBe("final_state");
  });
});
