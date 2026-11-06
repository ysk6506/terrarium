/**
 * Tool scope (REQ-080, ADR-0087 items 1, 2, 3 and 5): what an experiment gives the agent is the designer's choice, the
 * default is what a real operations team has, every tool is described the same way, and every fault says which tools
 * solve it, so an experiment that gives fewer tools can tell which scenarios it can still ask for.
 */
import {
  ALL_SCENARIO_TEMPLATES,
  BASE_TOOLS,
  CONTROL_ROWS,
  emptyScenario,
  FAULT_RESPONSES,
  FAULT_TOOLS,
  mainProblems,
  requiredTools,
  type ScenarioDoc,
  scenarioProblems,
  scopeCheck,
} from "@terrarium/core/scenario";
import { Session } from "@terrarium/core/session";
import {
  DEFAULT_TOOLSET,
  OPT_IN_TOOLS,
  TOOL_AREA_LABELS,
  TOOL_AREAS,
  TOOL_DOCS,
  TOOL_NAMES,
  TOOL_SPECS,
  validateArgs,
} from "@terrarium/core/tools";
import { BlueprintIndex, FAULT_SPECS, MISTAKE_SPECS } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { sampleBlueprint } from "../../packages/core/src/world/test-support/sample";

const index = () => new BlueprintIndex(sampleBlueprint());
const template = (id: string) => {
  const t = ALL_SCENARIO_TEMPLATES.find((x) => x.id === id);
  if (!t) throw new Error(id);
  return t.build(index(), "sample");
};

describe("every tool is described the same way [REQ-080]", () => {
  test("each tool fills the five slots, a card of the picker and a reality tag", () => {
    expect(Object.keys(TOOL_DOCS).sort()).toEqual([...TOOL_NAMES].sort());
    for (const name of TOOL_NAMES) {
      const doc = TOOL_DOCS[name];
      expect(doc, name).toBeDefined();
      if (!doc) continue;
      for (const slot of [doc.summary, doc.use, doc.notUse, doc.example, doc.costWhy])
        expect(slot.trim().length, `${name}: an empty slot`).toBeGreaterThan(8);
      expect(["low", "medium", "high"], name).toContain(doc.cost);
      expect(TOOL_AREAS, name).toContain(doc.area);
      expect(["common", "rare", "ideal"], name).toContain(doc.realism);
    }
  });

  test("the example is one valid input of the tool", () => {
    for (const spec of TOOL_SPECS) {
      const example = JSON.parse(TOOL_DOCS[spec.name]?.example ?? "null");
      expect(
        validateArgs(spec.inputSchema, example),
        `${spec.name}: ${JSON.stringify(example)}`,
      ).toEqual([]);
    }
  });

  test('"when not to use" says what to use instead, by the name of a real tool', () => {
    for (const name of TOOL_NAMES) {
      const instead = (TOOL_DOCS[name]?.notUse.match(/\(use ([a-z_]+)/g) ?? []).map((m) =>
        m.replace("(use ", ""),
      );
      for (const other of instead)
        expect(TOOL_NAMES, `${name} points at ${other}`).toContain(other);
    }
  });

  test("the description the agent reads is made from the same slots, in the same order", () => {
    for (const spec of TOOL_SPECS) {
      const doc = TOOL_DOCS[spec.name];
      const lines = spec.description.split("\n");
      expect(lines[0], spec.name).toBe(doc?.summary);
      expect(lines[1], spec.name).toBe(`Use when: ${doc?.use}`);
      expect(lines[2], spec.name).toBe(`Don't use when: ${doc?.notUse}`);
      expect(lines[3], spec.name).toBe(`Example: ${doc?.example}`);
      expect(lines[4], spec.name).toBe(
        `Access: ${spec.mutating ? "changes the world" : "read-only"}.`,
      );
      expect(lines[5], spec.name).toMatch(/^Cost: (low|medium|high) \(/);
    }
  });

  test("the picker has a card for every area and names it", () => {
    for (const area of TOOL_AREAS) {
      expect(TOOL_AREA_LABELS[area].length).toBeGreaterThan(0);
      expect(
        TOOL_SPECS.some((t) => t.area === area),
        area,
      ).toBe(true);
    }
  });
});

describe("the default tools are what a real team has [REQ-080]", () => {
  test("only common tools, the shell included, no topology or impact analysis", () => {
    for (const name of DEFAULT_TOOLSET) expect(TOOL_DOCS[name]?.realism, name).toBe("common");
    expect(DEFAULT_TOOLSET).toContain("run_command");
    expect(DEFAULT_TOOLSET).not.toContain("get_topology");
    expect(DEFAULT_TOOLSET).not.toContain("get_impact");
  });

  test("rare and ideal tools, and the ones that need an arrangement, come only when turned on", () => {
    expect(TOOL_DOCS.get_topology?.realism).toBe("rare");
    expect(TOOL_DOCS.get_impact?.realism).toBe("ideal");
    for (const name of OPT_IN_TOOLS) expect(DEFAULT_TOOLSET).not.toContain(name);
  });
});

describe("every fault says which tools solve it [REQ-080]", () => {
  const keys = [...FAULT_SPECS, ...MISTAKE_SPECS].map((s) => s.type);

  test("no fault and no mistake is missing from the table, and the table lists no stranger", () => {
    expect(Object.keys(FAULT_TOOLS).sort()).toEqual([...keys].sort());
  });

  test("the tools exist and a fault no tool cures says so", () => {
    for (const [key, need] of Object.entries(FAULT_TOOLS)) {
      for (const t of need.tools) expect(TOOL_NAMES, `${key}: ${t}`).toContain(t);
      expect(need.remedy === "diagnose", key).toBe(need.tools.length === 0);
    }
  });

  test("the tools of a fault are those of the control rows its remedy goes through", () => {
    for (const [fault, response] of Object.entries(FAULT_RESPONSES)) {
      const derived = [
        ...new Set(
          response.via.flatMap(
            (id) => CONTROL_ROWS.find((r) => r.id === id)?.agent.map((a) => a.tool) ?? [],
          ),
        ),
      ];
      const need = FAULT_TOOLS[fault as keyof typeof FAULT_TOOLS];
      expect(need.remedy, fault).toBe(response.remedy);
      expect([...need.tools].sort(), fault).toEqual(derived.sort());
    }
  });
});

describe("what a scenario needs, and what it can still be asked with [REQ-080]", () => {
  test("a scenario is about the faults its diagnosis names; the rest are background", () => {
    const cooling = template("cooling-failure");
    expect(scenarioProblems(cooling)).toEqual(["cooling_unit_failure"]);
    const withBackground = {
      ...cooling,
      nodes: [
        ...cooling.nodes,
        {
          id: "noise",
          type: "inject_fault",
          params: { faultType: "log_flood", target: "srv-a1", durationSeconds: 0 },
          position: { x: 0, y: 0 },
        },
      ],
    };
    expect(scenarioProblems(withBackground)).toContain("log_flood");
    expect(mainProblems(withBackground)).toEqual(["cooling_unit_failure"]);
  });

  test("with the cooling tools it is in scope; without them the missing tool is named", () => {
    const doc = template("cooling-failure");
    expect(scopeCheck(doc, DEFAULT_TOOLSET)).toMatchObject({ inScope: true });
    const without = scopeCheck(doc, ["list_alarms", "get_entity"]);
    expect(without.inScope).toBe(false);
    expect(without.reason).toContain("set_cooling_setpoint");
    expect(without.reason).toContain("풀 수 없어요");
  });

  test("a scenario about a mistake in a switch needs a switch tool, which the default does not have", () => {
    const doc: ScenarioDoc = {
      ...emptyScenario("net", "sample"),
      nodes: [
        { id: "start", type: "start", params: {}, position: { x: 0, y: 0 } },
        {
          id: "shut",
          type: "port_admin",
          params: { target: "tor-a", peer: "srv-a1", down: true },
          position: { x: 0, y: 0 },
        },
      ],
      expectations: [
        {
          id: "d",
          kind: "diagnosis" as const,
          rootCause: ["tor-a"],
          faultType: ["port_shutdown"],
          weight: 60,
        },
      ],
    };
    const out = scopeCheck(doc, DEFAULT_TOOLSET);
    expect(out.inScope).toBe(false);
    expect(out.reason).toContain("network_cli");
    expect(scopeCheck(doc, [...DEFAULT_TOOLSET, "network_cli"]).inScope).toBe(true);
    expect(requiredTools(doc)).toContain("network_cli");
  });

  test("the fewest tools it names are enough for every built-in scenario", () => {
    for (const t of ALL_SCENARIO_TEMPLATES) {
      if (t.unavailable(index())) continue;
      const doc = t.build(index(), "sample");
      const need = requiredTools(doc);
      expect(need, t.id).toEqual(expect.arrayContaining([...BASE_TOOLS]));
      expect(scopeCheck(doc, need).inScope, t.id).toBe(true);
      for (const tool of need) expect(TOOL_NAMES, `${t.id}: ${tool}`).toContain(tool);
    }
  });
});

describe("faults can be limited to what the given tools reach [REQ-080]", () => {
  const withBackground = () => {
    const cooling = template("cooling-failure");
    return {
      ...cooling,
      nodes: [
        ...cooling.nodes,
        {
          id: "noise",
          type: "inject_fault",
          params: { faultType: "disk_full", target: "srv-a1", durationSeconds: 0 },
          position: { x: 0, y: 0 },
        },
      ],
      edges: [...cooling.edges, { id: "e-noise", from: "start", port: "next", to: "noise" }],
    };
  };
  const faultsOf = (s: Session) => s.world.faults().map((f) => f.type);

  test("a background fault the tools cannot reach does not happen when faults are limited", () => {
    const scenario = withBackground();
    const tools = DEFAULT_TOOLSET.filter((t) => t !== "run_command");
    const inside = Session.create({
      blueprint: sampleBlueprint(),
      scenario,
      tools,
      seed: 3,
      faultScope: "inside",
    });
    inside.start();
    expect(faultsOf(inside)).toEqual(["cooling_unit_failure"]);
    const all = Session.create({ blueprint: sampleBlueprint(), scenario, tools, seed: 3 });
    all.start();
    expect(faultsOf(all).sort()).toEqual(["cooling_unit_failure", "disk_full"]);
  });

  test("a background fault the tools do reach still happens", () => {
    const inside = Session.create({
      blueprint: sampleBlueprint(),
      scenario: withBackground(),
      tools: DEFAULT_TOOLSET,
      seed: 3,
      faultScope: "inside",
    });
    inside.start();
    expect(faultsOf(inside).sort()).toEqual(["cooling_unit_failure", "disk_full"]);
  });
});
