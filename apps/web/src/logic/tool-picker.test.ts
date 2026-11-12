import type { ScenarioRecord } from "@terrarium/core/experiments";
import { ALL_SCENARIO_TEMPLATES } from "@terrarium/core/scenario";
import { toolPickCheck } from "@terrarium/core/session";
import { DEFAULT_TOOLSET, TOOL_AREAS, TOOL_NAMES } from "@terrarium/core/tools";
import { BlueprintIndex } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { sampleBlueprint } from "../../../../packages/core/src/world/test-support/sample";
import { experiment, toolPicker } from ".";

const doc = (id: string) => {
  const t = ALL_SCENARIO_TEMPLATES.find((x) => x.id === id);
  if (!t) throw new Error(id);
  return t.build(new BlueprintIndex(sampleBlueprint()), "sample");
};

const record = (id: string): ScenarioRecord => {
  const d = doc(id);
  return {
    id,
    worldId: "sample",
    name: d.name,
    owner: "haneul",
    doc: d,
    digest: id,
    createdAt: "",
    updatedAt: "",
  };
};

describe("the tool cards [REQ-080]", () => {
  test("a card for each area, each tool in exactly one, and the default on", () => {
    const cards = toolPicker.areaCards(DEFAULT_TOOLSET);
    expect(cards.map((c) => c.area)).toEqual([...TOOL_AREAS]);
    expect(cards.flatMap((c) => c.tools.map((t) => t.name)).sort()).toEqual([...TOOL_NAMES].sort());
    const on = cards.flatMap((c) => c.tools.filter((t) => t.on).map((t) => t.name));
    expect(on.sort()).toEqual([...new Set([...DEFAULT_TOOLSET, "submit_diagnosis"])].sort());
  });

  test("every tool carries how common it is: 흔함, 드묾 or 없음", () => {
    const rows = toolPicker.areaCards([]).flatMap((c) => c.tools);
    expect(rows.find((t) => t.name === "run_command")?.realismLabel).toBe("흔함");
    expect(rows.find((t) => t.name === "get_topology")?.realismLabel).toBe("드묾");
    expect(rows.find((t) => t.name === "get_impact")?.realismLabel).toBe("없음");
  });

  test("turning on a tool real teams do not have says what the experiment then measures", () => {
    const rows = (tools: string[]) => toolPicker.areaCards(tools).flatMap((c) => c.tools);
    const off = rows([]).find((t) => t.name === "get_impact");
    expect(off?.note).toBeUndefined();
    const on = rows(["get_impact"]).find((t) => t.name === "get_impact");
    expect(on?.note).toBe("현실엔 거의 없는 툴이에요 — 이 툴의 가치를 재는 실험이 돼요");
    expect(rows(["run_command"]).find((t) => t.name === "run_command")?.note).toBeUndefined();
  });

  test("a search narrows the cards to the tools that answer it, by name, title, card or tag", () => {
    const names = (q: string) =>
      toolPicker.areaCards([], q).flatMap((c) => c.tools.map((t) => t.name));
    expect(names("냉방")).toEqual(
      expect.arrayContaining(["set_cooling_setpoint", "restart_cooling_unit", "bacnet_request"]),
    );
    expect(names("get_impact")).toEqual(["get_impact"]);
    expect(names("없음")).toEqual(["get_impact"]);
    expect(names("드묾").sort()).toEqual([
      "bbu_status",
      "breaker_reset",
      "breaker_status",
      "cdu_pump_switch",
      "dr_drill",
      "dr_failback",
      "dr_failover",
      "get_topology",
      "mesh_rollback",
      "mesh_status",
      "overlay_trace",
      "power_cap_status",
      "region_failover",
      "replication_status",
      "search_runbooks",
      "set_power_cap",
      "site_status",
      "substation_status",
      "transfer_feed",
      "volume_promote",
    ]);
    expect(names("전혀 없는 말")).toEqual([]);
    expect(toolPicker.areaCards([], "전혀 없는 말")).toEqual([]);
  });

  test("an area turns on or off as a whole, and the answer stays", () => {
    const all = toolPicker.setTools([], ["wait", "submit_diagnosis"], true);
    expect(all).toEqual(["wait"]);
    expect(toolPicker.setTools(["wait", "list_alarms"], ["wait"], false)).toEqual(["list_alarms"]);
    expect(
      toolPicker
        .areaCards([])
        .flatMap((c) => c.tools)
        .find((t) => t.name === "submit_diagnosis"),
    ).toMatchObject({ on: true, locked: true });
  });

  test("tools the agent already has are on and cannot be switched when handing over more", () => {
    const rows = toolPicker.areaCards(["get_impact"], "", ["list_alarms"]).flatMap((c) => c.tools);
    expect(rows.find((t) => t.name === "list_alarms")).toMatchObject({ on: true, locked: true });
    expect(rows.find((t) => t.name === "get_impact")).toMatchObject({ on: true, locked: false });
  });
});

describe("the tools a scenario needs [REQ-080]", () => {
  test("they are worked out from its faults, and say which are still off", () => {
    const need = toolPicker.needOf(doc("cooling-failure"), ["list_alarms"]);
    expect(need?.tools).toEqual(["list_alarms", "submit_diagnosis", "set_cooling_setpoint"]);
    expect(need?.missing).toEqual(["set_cooling_setpoint"]);
    expect(need?.exact).toBe(false);
  });

  test("no scenario, no answer", () => {
    expect(toolPicker.needOf(undefined, [])).toBeUndefined();
  });

  test("turning on just those leaves nothing else on, and then there is nothing left to do", () => {
    const d = doc("cooling-failure");
    const only = toolPicker.onlyNeeded(d);
    expect(only).toEqual(["list_alarms", "set_cooling_setpoint"]);
    expect(toolPicker.needOf(d, only)).toMatchObject({ missing: [], exact: true });
  });
});

describe("which scenarios the tools can still solve [REQ-080]", () => {
  const records = [record("cooling-failure"), record("pdu-breaker-cascade")];

  test("limited to the given tools, the ones they cannot solve are greyed out, with the tool that is missing", () => {
    const choices = toolPicker.scenarioChoices(records, ["list_alarms", "reset_breaker"], "inside");
    expect(choices.map((c) => [c.id, c.out])).toEqual([
      ["cooling-failure", true],
      ["pdu-breaker-cascade", false],
    ]);
    expect(choices[0]?.reason).toBe("`set_cooling_setpoint`이 없어서 풀 수 없어요");
  });

  test("not limited, they can all be chosen, and the reason is still told", () => {
    const choices = toolPicker.scenarioChoices(records, ["list_alarms"], "all");
    expect(choices.every((c) => !c.out)).toBe(true);
    expect(choices[0]?.reason).toContain("set_cooling_setpoint");
  });

  test("the form refuses a scenario out of reach only when faults are limited", () => {
    const d = doc("cooling-failure");
    const base = { ...experiment.emptyDraft(), worldId: "w", scenarioId: "cooling-failure" };
    const tools = ["list_alarms"];
    const loose = experiment.draftProblems({ ...base, tools, faultScope: "all" }, undefined, d);
    expect(loose.what).toEqual([]);
    const tight = experiment.draftProblems({ ...base, tools, faultScope: "inside" }, undefined, d);
    expect(tight.what[0]).toContain("set_cooling_setpoint이 없어서 풀 수 없어요");
    expect(tight.what[0]).not.toContain("`");
  });
});

describe("the tool-pick matrix [REQ-080]", () => {
  test("rows are situations, columns the tools, and a cell says hit, extra or miss", () => {
    const m = toolPicker.pickMatrix(toolPickCheck(DEFAULT_TOOLSET));
    expect(m.rows.length).toBeGreaterThan(5);
    expect(m.rows.every((r) => r.cells.length === m.columns.length)).toBe(true);
    const power = m.rows.find((r) => r.id === "power_dark");
    const col = (name: string) => m.columns.indexOf(name);
    expect(power?.cells[col("facility_status")]).toBe("hit");
    expect(power?.cells[col("reset_breaker")]).toBe("hit");
    expect(m.pairs).toEqual([]);
  });

  test("a pair the descriptions cannot separate is named with the situations in words", () => {
    const check = toolPickCheck(TOOL_NAMES);
    const made = toolPicker.pickMatrix({
      ...check,
      ambiguous: [{ a: "facility_status", b: "reset_breaker", situations: ["power_dark"] }],
    });
    expect(made.pairs).toEqual([
      { a: "facility_status", b: "reset_breaker", situations: ["전원이 끊겼어요"] },
    ]);
    expect(toolPicker.PICK_WORDS.pair("facility_status", "reset_breaker")).toBe(
      "설비 현황과 차단기 리셋이",
    );
  });
});
