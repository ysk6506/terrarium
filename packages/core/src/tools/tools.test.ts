/**
 * Unit tests for the tools against a world with no physics running: state and alarms are set
 * directly, facades are fakes. Cascades through the physics are specified in tests/spec/tools.test.ts.
 */
import { Catalog } from "@terrarium/core/catalog";
import type { FacadeRequest, Facades } from "@terrarium/core/facades";
import { type Alarm, World } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { sampleBlueprint } from "../world/test-support/sample";
import {
  DEFAULT_TOOLSET,
  type Diagnosis,
  dependencies,
  dependents,
  TOOL_NAMES,
  TOOL_SPECS,
  Toolbox,
  type ToolContext,
  validateArgs,
} from ".";

/** Facades that echo what they were asked, so tests see exactly what the tool forwarded. */
function echoFacades(): Facades & { calls: Array<[string, string | undefined, FacadeRequest]> } {
  const calls: Array<[string, string | undefined, FacadeRequest]> = [];
  const echo = (name: string, server: string | undefined, req: FacadeRequest) => {
    calls.push([name, server, req]);
    return { status: 200, headers: {}, body: { name } };
  };
  return {
    calls,
    redfish: { handle: (server, req) => echo("redfish", server, req) },
    vcenter: { handle: (req) => echo("vcenter", undefined, req) },
    vrops: { handle: (req) => echo("vrops", undefined, req) },
  };
}

function setup(extra: Partial<ToolContext> = {}) {
  const world = World.fromBlueprint(sampleBlueprint(), new Catalog());
  world.advance(600);
  const facades = echoFacades();
  const ctx: ToolContext = { world, facades, ...extra };
  return { world, facades, ctx, tools: new Toolbox(TOOL_NAMES) };
}

function raise(world: World, alarm: Omit<Alarm, "id" | "message"> & { message?: string }) {
  const full = { message: alarm.code, ...alarm, id: `${alarm.code}:${alarm.entityId}` };
  world.apply({ type: "alarm.raise", alarm: full }, "physics");
}

const data = (result: { ok: boolean; data?: unknown; error?: string }) => {
  expect(result.error).toBeUndefined();
  return result.data as any;
};

describe("tool catalog [REQ-007] [REQ-031]", () => {
  test("every tool has a unique snake_case name, a Korean title, a description and a handler", () => {
    expect(new Set(TOOL_NAMES).size).toBe(TOOL_SPECS.length);
    for (const spec of TOOL_SPECS) {
      expect(spec.name).toMatch(/^[a-z][a-z_]+$/);
      expect(spec.title).toMatch(/[가-힣]/);
      expect(spec.description.length).toBeGreaterThan(20);
      for (const key of spec.inputSchema.required)
        expect(spec.inputSchema.properties).toHaveProperty(key);
    }
    expect(DEFAULT_TOOLSET).not.toContain("redfish_request");
    expect(DEFAULT_TOOLSET).toContain("submit_diagnosis");
  });

  test("an experiment only sees the tools it selected; unknown tools are refused up front", () => {
    const { ctx } = setup();
    const box = new Toolbox(["list_alarms"]);
    expect(box.list().map((t) => t.name)).toEqual(["list_alarms"]);
    expect(box.has("get_entity")).toBe(false);
    expect(box.call("get_entity", { id: "srv-a1" }, ctx)).toMatchObject({
      ok: false,
      error: expect.stringContaining("not available"),
    });
    expect(() => new Toolbox(["nope"])).toThrow(/unknown tools: nope/);
  });

  test("arguments are validated with messages an agent can act on", () => {
    const schema = TOOL_SPECS.find((t) => t.name === "power_server")?.inputSchema as never;
    expect(validateArgs(schema, { id: "srv-a1", action: "on" })).toEqual([]);
    expect(validateArgs(schema, {})).toEqual([
      "missing required argument 'id'",
      "missing required argument 'action'",
    ]);
    expect(validateArgs(schema, { id: 5, action: "explode", extra: 1 })).toEqual([
      "argument 'id' must be a string",
      "argument 'action' must be one of on, off",
      "unknown argument 'extra' (allowed: id, action)",
    ]);
    const { ctx, tools } = setup();
    expect(tools.call("power_server", { id: "srv-a1" }, ctx)).toMatchObject({
      ok: false,
      error: "missing required argument 'action'",
    });
  });

  test("domain errors become tool errors instead of crashing the session", () => {
    const { ctx, tools } = setup();
    expect(tools.call("get_entity", { id: "ghost" }, ctx)).toMatchObject({
      ok: false,
      error: expect.stringContaining("no entity 'ghost'"),
    });
    expect(
      tools.call("set_cooling_setpoint", { unitId: "crah-1", celsius: 99 }, ctx),
    ).toMatchObject({ ok: false, error: expect.stringContaining("between 16 and 27") });
  });
});

describe("observation tools [REQ-007]", () => {
  test("list_alarms orders critical first, then oldest, and filters", () => {
    const { world, ctx, tools } = setup();
    raise(world, { entityId: "srv-b1", code: "fan_failed", severity: "warning", since: 100 });
    raise(world, { entityId: "pdu-a", code: "breaker_tripped", severity: "critical", since: 300 });
    raise(world, { entityId: "srv-a1", code: "power_lost", severity: "critical", since: 200 });
    const codes = (args: Record<string, unknown>) =>
      (data(tools.call("list_alarms", args, ctx)) as any[]).map((a) => `${a.entityId}/${a.code}`);
    expect(codes({})).toEqual(["srv-a1/power_lost", "pdu-a/breaker_tripped", "srv-b1/fan_failed"]);
    expect(codes({ severity: "warning" })).toEqual(["srv-b1/fan_failed"]);
    expect(codes({ entityId: "pdu-a" })).toEqual(["pdu-a/breaker_tripped"]);
    expect(data(tools.call("list_alarms", {}, ctx))[0]).toEqual({
      entityId: "srv-a1",
      code: "power_lost",
      severity: "critical",
      message: "power_lost",
      since: 200,
    });
  });

  test("list_entities filters by kind and container", () => {
    const { ctx, tools } = setup();
    const ids = (args: Record<string, unknown>) =>
      (data(tools.call("list_entities", args, ctx)) as any[]).map((e) => e.id);
    expect(ids({ kind: "server" })).toEqual(["srv-a1", "srv-a2", "srv-b1"]);
    expect(ids({ under: "rack-b" })).toEqual(["pdu-b", "srv-b1", "stor-b"]);
    expect(ids({ kind: "pdu", under: "rack-b" })).toEqual(["pdu-b"]);
  });

  test("get_entity gives location, model, connections, rounded state and alarms", () => {
    const { world, ctx, tools } = setup();
    world.patch("srv-a1", "server", { inletC: 23.45678 });
    raise(world, {
      entityId: "srv-a1",
      code: "inlet_hot",
      severity: "warning",
      since: 1,
      message: "흡기 온도 높음",
    });
    const entity = data(tools.call("get_entity", { id: "srv-a1" }, ctx));
    expect(entity).toMatchObject({
      kind: "server",
      model: "2U 범용 서버",
      location: "site > bldg > fl1 > hall > ca1 > rack-a > srv-a1",
      children: [],
      alarms: ["흡기 온도 높음"],
    });
    expect(entity.connections).toMatchObject({
      power_to: ["pdu-a"],
      network_to: ["tor-a"],
      runs_on_from: ["vm-web"],
      member_of_to: ["cl1"],
    });
    expect(entity.state.inletC).toBe(23.46);
    expect(entity.state.fanRpm).toEqual(Array(6).fill(6000)); // the 2U model has six fans
    expect(entity.state).not.toHaveProperty("kind");
  });

  test("get_topology walks dependency links to the requested depth", () => {
    const { ctx, tools } = setup();
    const one = data(tools.call("get_topology", { id: "srv-a1", depth: 1 }, ctx));
    expect(one.nodes.map((n: any) => n.id)).toEqual(["cl1", "pdu-a", "srv-a1", "tor-a", "vm-web"]);
    const two = data(tools.call("get_topology", { id: "srv-a1" }, ctx));
    expect(two.nodes.length).toBeGreaterThan(one.nodes.length);
    expect(two.edges).toContainEqual({ kind: "power", from: "pdu-a", to: "panel-1" });
    const capped = data(tools.call("get_topology", { id: "srv-a1", depth: 99 }, ctx));
    expect(capped).toEqual(data(tools.call("get_topology", { id: "srv-a1", depth: 4 }, ctx)));
  });

  test("get_impact follows the same cascade as the physics", () => {
    const { ctx, tools } = setup();
    // A cooling failure overheats the servers in the racks it cools (and their VMs), not the PDUs or switches there.
    expect(data(tools.call("get_impact", { id: "crah-1" }, ctx))).toEqual({
      id: "crah-1",
      dependents: ["rack-a", "rack-b", "srv-a1", "srv-a2", "srv-b1", "vm-db", "vm-web"],
      dependencies: ["panel-1", "ups-1"],
    });
    // pdu-a powers tor-a, so everything behind that switch is at risk too, including storage on pdu-b.
    expect(data(tools.call("get_impact", { id: "pdu-a" }, ctx)).dependents).toEqual([
      "ds1",
      "srv-a1",
      "srv-a2",
      "srv-b1",
      "stor-b",
      "tor-a",
      "vm-db",
      "vm-web",
    ]);
    // vm-db needs its host's power, network and cooling, and its datastore's storage array (on pdu-b).
    expect(data(tools.call("get_impact", { id: "vm-db" }, ctx))).toEqual({
      id: "vm-db",
      dependents: [],
      dependencies: [
        "crah-1",
        "ds1",
        "panel-1",
        "pdu-a",
        "pdu-b",
        "srv-a2",
        "stor-b",
        "tor-a",
        "ups-1",
      ],
    });
    // Cluster membership is bookkeeping, not a supply: losing the cluster object stops nothing.
    expect(data(tools.call("get_impact", { id: "cl1" }, ctx)).dependents).toEqual([]);
    // Losing a container loses everything inside it.
    expect(data(tools.call("get_impact", { id: "rack-b" }, ctx)).dependents).toEqual(
      expect.arrayContaining(["pdu-b", "srv-b1", "stor-b", "ds1"]),
    );
  });

  test("'A affects B' holds exactly when 'B depends on A', for every pair of devices", () => {
    const { world, ctx } = setup();
    const devices = world.index
      .all()
      .filter((e) => world.index.childrenOf(e.id).length === 0)
      .map((e) => e.id);
    const mismatches: string[] = [];
    for (const a of devices) {
      const affected = new Set(dependents(ctx, a));
      for (const b of devices)
        if (affected.has(b) !== dependencies(ctx, b).includes(a)) mismatches.push(`${a} -> ${b}`);
    }
    expect(devices.length).toBeGreaterThan(15);
    expect(mismatches).toEqual([]);
  });

  test("query_metrics reads the session's recorder, or explains why it cannot", () => {
    const { ctx, tools } = setup({
      metrics: {
        series: (id, metric, since) =>
          id === "srv-a1" && metric === "inletC" ? [[since + 1, 21.234]] : [],
      },
    });
    const query = { id: "srv-a1", metric: "inletC", lastSeconds: 60 };
    expect(data(tools.call("query_metrics", query, ctx)).points).toEqual([[541, 21.23]]);
    expect(tools.call("query_metrics", { id: "srv-a1", metric: "nope" }, ctx)).toMatchObject({
      ok: false,
      error: expect.stringContaining("no samples"),
    });
    const bare = setup();
    expect(
      bare.tools.call("query_metrics", { id: "srv-a1", metric: "inletC" }, bare.ctx),
    ).toMatchObject({ ok: false, error: expect.stringContaining("not recorded") });
  });

  test("facility_status summarises cooling and power per room", () => {
    const { ctx, tools } = setup();
    const [hall] = data(tools.call("facility_status", {}, ctx)) as any[];
    expect(hall).toMatchObject({
      room: "hall",
      cooling: [{ id: "crah-1" }, { id: "crah-2" }],
      panels: [{ id: "panel-1" }],
      ups: [{ id: "ups-1" }],
    });
    expect(hall.pdus.map((p: any) => p.id)).toEqual(["pdu-a", "pdu-b"]);
    expect(data(tools.call("facility_status", { roomId: "nope" }, ctx))).toEqual([]);
  });
});

describe("protocol and action tools [REQ-007]", () => {
  test("protocol tools forward the request to the session's facades unchanged", () => {
    const { ctx, tools, facades } = setup();
    const path = "/redfish/v1/Systems/System.Embedded.1";
    data(tools.call("redfish_request", { server: "srv-a1", method: "GET", path }, ctx));
    data(
      tools.call(
        "vcenter_request",
        { method: "GET", path: "/api/vcenter/vm", query: { names: "vm-web" } },
        ctx,
      ),
    );
    data(
      tools.call(
        "vrops_request",
        { method: "POST", path: "/suite-api/api/auth/token/acquire" },
        ctx,
      ),
    );
    expect(facades.calls).toEqual([
      ["redfish", "srv-a1", { method: "GET", path, query: {}, headers: {}, body: undefined }],
      [
        "vcenter",
        undefined,
        {
          method: "GET",
          path: "/api/vcenter/vm",
          query: { names: "vm-web" },
          headers: {},
          body: undefined,
        },
      ],
      [
        "vrops",
        undefined,
        {
          method: "POST",
          path: "/suite-api/api/auth/token/acquire",
          query: {},
          headers: {},
          body: undefined,
        },
      ],
    ]);
  });

  test("action tools change the simulated world and record the tool as the cause", () => {
    const { world, ctx, tools } = setup();
    data(tools.call("set_cooling_setpoint", { unitId: "crah-1", celsius: 18 }, ctx));
    expect(world.stateAs("crah-1", "cooling_unit").setpointC).toBe(18);
    data(tools.call("power_server", { id: "srv-b1", action: "off" }, ctx));
    expect(world.stateAs("srv-b1", "server").adminOn).toBe(false);
    expect(world.events().at(-1)?.cause).toBe("tool:power_server");
    expect(tools.call("power_server", { id: "rack-a", action: "off" }, ctx).ok).toBe(false);
  });

  test("restarting a cooling unit does not fix a hardware fault", () => {
    const { world, ctx, tools } = setup();
    world.apply(
      {
        type: "fault.add",
        fault: { id: "c", type: "cooling_unit_failure", target: "crah-1", params: {} },
      },
      "scenario",
    );
    expect(data(tools.call("restart_cooling_unit", { unitId: "crah-2" }, ctx))).toEqual({
      unitId: "crah-2",
      restarted: true,
    });
    expect(data(tools.call("restart_cooling_unit", { unitId: "crah-1" }, ctx))).toMatchObject({
      restarted: false,
      message: expect.stringContaining("compressor fault"),
    });
    expect(world.faultsOn("crah-1")).toHaveLength(1);
    expect(tools.call("restart_cooling_unit", { unitId: "srv-a1" }, ctx).ok).toBe(false);
  });

  test("reset_breaker clears a trip but leaves other faults", () => {
    const { world, ctx, tools } = setup();
    world.apply(
      { type: "fault.add", fault: { id: "t", type: "breaker_trip", target: "pdu-b", params: {} } },
      "scenario",
    );
    world.apply(
      { type: "fault.add", fault: { id: "s", type: "sensor_drift", target: "srv-b1", params: {} } },
      "scenario",
    );
    expect(data(tools.call("reset_breaker", { id: "pdu-b" }, ctx))).toEqual({
      id: "pdu-b",
      reset: true,
    });
    expect(world.faultsOn("pdu-b")).toEqual([]);
    expect(world.faultsOn("srv-b1")).toHaveLength(1);
  });

  test("wait advances time through the session, within bounds", () => {
    const waited: number[] = [];
    const { world, ctx, tools } = setup({
      wait: (s) => {
        waited.push(s);
        world.advance(s);
      },
    });
    expect(data(tools.call("wait", { seconds: 120 }, ctx))).toEqual({ waited: 120, now: 720 });
    expect(waited).toEqual([120]);
    expect(tools.call("wait", { seconds: 0 }, ctx).ok).toBe(false);
    expect(tools.call("wait", { seconds: 3601 }, ctx).ok).toBe(false);
    const bare = setup();
    expect(bare.tools.call("wait", { seconds: 10 }, bare.ctx)).toMatchObject({
      ok: false,
      error: expect.stringContaining("cannot advance"),
    });
  });

  test("submit_diagnosis hands the structured answer to the session", () => {
    const answers: Diagnosis[] = [];
    const { ctx, tools } = setup({ submit: (d) => answers.push(d) });
    const full = {
      rootCause: "crah-1",
      faultType: "cooling_unit_failure",
      summary: "CRAH-1 stopped",
      actions: ["raised setpoint"],
      confidence: 0.8,
    };
    expect(data(tools.call("submit_diagnosis", full, ctx))).toEqual({ accepted: true });
    data(tools.call("submit_diagnosis", { rootCause: "x", faultType: "y", summary: "z" }, ctx));
    expect(answers).toEqual([full, { rootCause: "x", faultType: "y", summary: "z", actions: [] }]);
  });
});

describe("what agents observe [REQ-007]", () => {
  test("tools show what sensors report, so a drifting sensor misleads the agent as it would a person", () => {
    const { world, ctx, tools } = setup();
    const truth = world.stateAs("srv-a1", "server").inletC;
    world.apply(
      {
        type: "fault.add",
        fault: { id: "d", type: "sensor_drift", target: "srv-a1", params: { deltaC: 9 } },
      },
      "scenario",
    );
    const shown = (
      tools.call("get_entity", { id: "srv-a1" }, ctx).data as { state: { inletC: number } }
    ).state.inletC;
    expect(shown).toBeCloseTo(truth + 9, 2);
    expect(world.stateAs("srv-a1", "server").inletC).toBe(truth);
    const rack = (
      tools.call("get_entity", { id: "rack-a" }, ctx).data as { state: { inletC: number } }
    ).state.inletC;
    expect(rack).toBeCloseTo(world.stateAs("rack-a", "rack").inletC, 2);
  });
});
