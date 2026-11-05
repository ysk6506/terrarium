import { describe, expect, test } from "vitest";
import { TOOL_SPECS } from "./catalog";
import { callEffect, callTargets, TARGET_ARGS } from "./targets";

describe("what a tool call touches [REQ-050]", () => {
  test("every tool says which arguments name equipment, and those arguments exist", () => {
    for (const spec of TOOL_SPECS) {
      const keys = TARGET_ARGS[spec.name];
      expect(keys, `${spec.name} is not listed`).toBeDefined();
      for (const key of keys ?? [])
        expect(Object.keys(spec.inputSchema.properties), `${spec.name}.${key}`).toContain(key);
    }
    expect(Object.keys(TARGET_ARGS).sort()).toEqual(TOOL_SPECS.map((s) => s.name).sort());
  });

  test("the ids come out in argument order, once each, and only when they are text", () => {
    expect(callTargets("get_entity", { id: "srv-1" })).toEqual(["srv-1"]);
    expect(
      callTargets("redfish_request", { server: "srv-2", method: "GET", path: "/redfish/v1" }),
    ).toEqual(["srv-2"]);
    expect(callTargets("list_alarms", { entityId: "room-a", severity: "critical" })).toEqual([
      "room-a",
    ]);
    expect(callTargets("get_entity", { id: "" })).toEqual([]);
    expect(callTargets("get_entity", { id: 7 })).toEqual([]);
    expect(callTargets("wait", { seconds: 30 })).toEqual([]);
    expect(callTargets("not_a_tool", { id: "x" })).toEqual([]);
  });

  test("a call is told apart as looking, acting, waiting or answering", () => {
    expect(callEffect("get_entity", { id: "a" })).toBe("observe");
    expect(callEffect("query_metrics", { id: "a", metric: "inletC" })).toBe("observe");
    expect(callEffect("power_server", { id: "a", action: "off" })).toBe("act");
    expect(callEffect("set_cooling_setpoint", { unitId: "u", celsius: 20 })).toBe("act");
    expect(callEffect("redfish_request", { server: "s", method: "GET", path: "/" })).toBe(
      "observe",
    );
    expect(callEffect("redfish_request", { server: "s", method: "post", path: "/" })).toBe("act");
    expect(callEffect("redfish_request", { server: "s", path: "/" })).toBe("observe");
    expect(callEffect("wait", { seconds: 5 })).toBe("wait");
    expect(callEffect("submit_diagnosis", { rootCause: "x" })).toBe("answer");
    expect(callEffect("not_a_tool", {})).toBe("observe");
  });
});
