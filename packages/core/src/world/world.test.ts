import { Catalog } from "@terrarium/core/catalog";
import { U_HEIGHT_M } from "@terrarium/core/kernel";
import { describe, expect, test } from "vitest";
import {
  absolutePosition,
  type Blueprint,
  BlueprintIndex,
  emptyBlueprint,
  FAULT_SPECS,
  faultSpec,
  footprint,
  hasErrors,
  heightU,
  isFaultType,
  ReadOnlyWorldPort,
  validateBlueprint,
  World,
} from ".";
import { sampleBlueprint, withChanges } from "./test-support/sample";

const catalog = new Catalog();
const codes = (bp: Blueprint) =>
  [...new Set(validateBlueprint(bp, catalog).map((i) => i.code))].sort();
const errors = (bp: Blueprint) =>
  [
    ...new Set(
      validateBlueprint(bp, catalog)
        .filter((i) => i.severity === "error")
        .map((i) => i.code),
    ),
  ].sort();
const entity = (bp: Blueprint, id: string) =>
  bp.entities.find((x) => x.id === id) as Blueprint["entities"][number];

describe("blueprint validation [REQ-035]", () => {
  test("the sample hall is valid and has no advice warnings", () => {
    expect(validateBlueprint(sampleBlueprint(), catalog)).toEqual([]);
    expect(validateBlueprint(emptyBlueprint("w", "빈 세계"), catalog)).toEqual([]);
  });

  test("duplicate and malformed ids are errors", () => {
    const bp = sampleBlueprint();
    expect(errors({ ...bp, entities: [...bp.entities, entity(bp, "rack-a")] })).toContain("W001");
    expect(
      errors(
        withChanges(bp, { entities: [{ ...entity(bp, "vc"), id: "bad id" }], remove: ["vc"] }),
      ),
    ).toContain("W002");
  });

  test("parents must exist and be of an allowed kind", () => {
    const bp = sampleBlueprint();
    expect(
      errors(withChanges(bp, { entities: [{ ...entity(bp, "srv-a1"), parentId: "ghost" }] })),
    ).toEqual(["W003"]);
    expect(
      errors(withChanges(bp, { entities: [{ ...entity(bp, "srv-a1"), parentId: "hall" }] })),
    ).toContain("W004");
    const { parentId: _drop, ...orphan } = entity(bp, "rack-a");
    expect(errors(withChanges(bp, { entities: [orphan] }))).toContain("W004");
  });

  test("placements must match the kind, models must exist and match the kind", () => {
    const bp = sampleBlueprint();
    expect(
      errors(
        withChanges(bp, {
          entities: [{ ...entity(bp, "rack-a"), placement: { type: "unit", u: 3 } }],
        }),
      ),
    ).toContain("W005");
    expect(
      errors(withChanges(bp, { entities: [{ ...entity(bp, "srv-a1"), modelId: "nope" }] })),
    ).toEqual(["W006"]);
    expect(
      errors(withChanges(bp, { entities: [{ ...entity(bp, "srv-a1"), modelId: "crah-100kw" }] })),
    ).toContain("W006");
  });

  test("things must stay inside their parent and have a positive size", () => {
    const bp = sampleBlueprint();
    expect(
      errors(
        withChanges(bp, {
          entities: [
            { ...entity(bp, "rack-a"), placement: { type: "spot", x: 11.8, y: 3, rotation: 0 } },
          ],
        }),
      ),
    ).toContain("W007");
    expect(
      errors(
        withChanges(bp, {
          entities: [
            { ...entity(bp, "hall"), placement: { type: "area", x: 55, y: 5, w: 12, d: 10 } },
          ],
        }),
      ),
    ).toContain("W007");
    expect(
      errors(
        withChanges(bp, {
          entities: [{ ...entity(bp, "ca1"), placement: { type: "area", x: 1, y: 1, w: 0, d: 2 } }],
        }),
      ),
    ).toContain("W007");
    expect(
      errors(
        withChanges(bp, {
          entities: [
            { ...entity(bp, "ups-1"), placement: { type: "spot", x: 59, y: 5, rotation: 0 } },
          ],
        }),
      ),
    ).toContain("W007");
  });

  test("racks and floor-standing equipment in one room must not overlap, even across containments", () => {
    const bp = sampleBlueprint();
    expect(
      errors(
        withChanges(bp, {
          entities: [
            { ...entity(bp, "rack-b"), placement: { type: "spot", x: 1.8, y: 3, rotation: 0 } },
          ],
        }),
      ),
    ).toEqual(["W008"]);
    expect(
      errors(
        withChanges(bp, {
          entities: [
            { ...entity(bp, "crah-2"), placement: { type: "spot", x: 3.0, y: 0.5, rotation: 0 } },
          ],
        }),
      ),
    ).toEqual(["W008"]);
    const rotated = withChanges(bp, {
      entities: [
        { ...entity(bp, "crah-2"), placement: { type: "spot", x: 4.0, y: 0.5, rotation: 90 } },
      ],
    });
    expect(errors(rotated)).toEqual([]);
  });

  test("rack units must be in range and must not overlap; vertical PDUs take no units", () => {
    const bp = sampleBlueprint();
    expect(
      errors(
        withChanges(bp, {
          entities: [{ ...entity(bp, "srv-a2"), placement: { type: "unit", u: 11 } }],
        }),
      ),
    ).toEqual(["W009"]);
    expect(
      errors(
        withChanges(bp, {
          entities: [{ ...entity(bp, "tor-a"), placement: { type: "unit", u: 43 } }],
        }),
      ),
    ).toEqual(["W009"]);
    expect(
      errors(
        withChanges(bp, {
          entities: [{ ...entity(bp, "pdu-a"), placement: { type: "unit", u: 10 } }],
        }),
      ),
    ).toEqual([]);
  });

  test("links must connect existing entities of allowed kinds, and power must not loop", () => {
    const bp = sampleBlueprint();
    const link = (kind: Blueprint["links"][number]["kind"], from: string, to: string) => ({
      id: "lx",
      kind,
      from,
      to,
      props: {},
    });
    expect(errors(withChanges(bp, { links: [link("power", "srv-a1", "ghost")] }))).toEqual([
      "W010",
    ]);
    expect(errors(withChanges(bp, { links: [link("network", "srv-a1", "pdu-a")] }))).toEqual([
      "W010",
    ]);
    expect(errors(withChanges(bp, { links: [link("cooling", "rack-a", "rack-a")] }))).toEqual([
      "W010",
    ]);
    expect(errors(withChanges(bp, { links: [link("power", "panel-1", "pdu-a")] }))).toEqual([
      "W011",
    ]);
  });

  test("advice warnings: unpowered devices, PDUs without a panel, rooms without cooling", () => {
    const bp = sampleBlueprint();
    const unpowered = withChanges(bp, {
      remove: bp.links.filter((x) => x.from === "srv-b1" && x.kind === "power").map((x) => x.id),
    });
    expect(codes(unpowered)).toEqual(["W020"]);
    const noPanel = withChanges(bp, {
      remove: bp.links.filter((x) => x.from === "pdu-b").map((x) => x.id),
    });
    expect(codes(noPanel)).toEqual(["W021"]);
    expect(codes(withChanges(bp, { remove: ["crah-1", "crah-2"] }))).toContain("W022");
    expect(hasErrors(validateBlueprint(unpowered, catalog))).toBe(false);
  });

  test("every issue says how to fix it", () => {
    const bp = sampleBlueprint();
    const broken = withChanges(bp, {
      entities: [{ ...entity(bp, "srv-a1"), parentId: "ghost", modelId: "nope" }],
    });
    for (const issue of validateBlueprint(broken, catalog))
      expect(issue.fix.length).toBeGreaterThan(3);
  });
});

describe("blueprint index and geometry [REQ-035]", () => {
  const index = new BlueprintIndex(sampleBlueprint());

  test("containment tree queries", () => {
    expect(index.childrenOf("rack-a").map((x) => x.id)).toEqual([
      "pdu-a",
      "srv-a1",
      "srv-a2",
      "tor-a",
    ]);
    expect(index.childrenOf("rack-a", "server").map((x) => x.id)).toEqual(["srv-a1", "srv-a2"]);
    expect(index.ancestors("srv-a1").map((x) => x.id)).toEqual([
      "rack-a",
      "ca1",
      "hall",
      "fl1",
      "bldg",
      "site",
    ]);
    expect(index.enclosing("srv-a1", "room")?.id).toBe("hall");
    expect(index.enclosing("hall", "room")?.id).toBe("hall");
    expect(index.descendants("ca1").map((x) => x.id)).toEqual([
      "rack-a",
      "pdu-a",
      "srv-a1",
      "srv-a2",
      "tor-a",
      "rack-b",
      "pdu-b",
      "srv-b1",
      "stor-b",
    ]);
    expect(() => index.entity("ghost")).toThrow(/no entity/);
    expect(() => index.link("ghost")).toThrow(/no link/);
  });

  test("link adjacency follows the dependency direction", () => {
    expect(index.upstream("srv-a1", "power")).toEqual(["pdu-a", "panel-1", "ups-1"]);
    expect(index.downstream("panel-1", "power")).toEqual([
      "crah-1",
      "crah-2",
      "pdu-a",
      "pdu-b",
      "srv-a1",
      "srv-a2",
      "tor-a",
      "srv-b1",
      "stor-b",
    ]);
    expect(index.incoming("crah-1", "cooling").map((x) => x.from)).toEqual(["rack-a", "rack-b"]);
    expect(index.outgoing("vm-web").map((x) => x.kind)).toEqual(["runs_on"]);
  });

  test("footprints and heights come from placements and models", () => {
    expect(footprint(index.entity("rack-a"), catalog)).toEqual({ x: 1.5, y: 3, w: 0.6, d: 1.2 });
    expect(footprint(index.entity("crah-1"), catalog)).toEqual({ x: 1.5, y: 0.5, w: 2.4, d: 0.9 });
    expect(footprint(index.entity("site"), catalog)).toEqual({ x: 0, y: 0, w: 200, d: 150 });
    expect(footprint(index.entity("srv-a1"), catalog)).toBeUndefined();
    expect(heightU(index.entity("srv-a1"), catalog)).toBe(2);
    expect(heightU(index.entity("pdu-a"), catalog)).toBe(0);
    expect(heightU(index.entity("rack-a"), catalog)).toBe(1);
  });

  test("absolute positions add up the chain from site to rack unit", () => {
    const rack = absolutePosition(index, catalog, "rack-a");
    expect(rack).toEqual({ x: 10 + 5 + 1.5 + 0.3, y: 10 + 5 + 3 + 0.6, z: 0 });
    const server = absolutePosition(index, catalog, "srv-a1");
    expect(server?.x).toBeCloseTo(16.8, 9);
    expect(server?.z).toBeCloseTo(9 * U_HEIGHT_M + U_HEIGHT_M, 9);
    expect(absolutePosition(index, catalog, "vm-web")).toBeUndefined();
  });

  test("upper floors stand on lower ones and basements sit below ground", () => {
    const bp = sampleBlueprint();
    const up = withChanges(bp, {
      entities: [{ ...entity(bp, "fl1"), placement: { type: "level", level: 3, height: 4.5 } }],
    });
    expect(absolutePosition(new BlueprintIndex(up), catalog, "hall")?.z).toBe(9);
    const down = withChanges(bp, {
      entities: [{ ...entity(bp, "fl1"), placement: { type: "level", level: -1, height: 5 } }],
    });
    expect(absolutePosition(new BlueprintIndex(down), catalog, "hall")?.z).toBe(-5);
  });
});

describe("world state and events [REQ-001] [REQ-014]", () => {
  const fresh = () => World.fromBlueprint(sampleBlueprint(), catalog);

  test("an invalid blueprint is refused with its errors listed", () => {
    const bp = sampleBlueprint();
    expect(() =>
      World.fromBlueprint(
        withChanges(bp, { entities: [{ ...entity(bp, "srv-a1"), modelId: "nope" }] }),
        catalog,
      ),
    ).toThrow(/W006/);
  });

  test("initial state reflects models and properties", () => {
    const world = fresh();
    expect(world.stateAs("srv-a1", "server")).toMatchObject({
      adminOn: true,
      powered: true,
      fanRpm: [6000, 6000, 6000, 6000, 6000, 6000],
      psuOk: [true, true],
    });
    expect(world.stateAs("crah-1", "cooling_unit").capacityKw).toBe(100);
    expect(world.stateAs("vm-web", "vm").cpuDemand).toBe(0.4);
    expect(world.stateOf("site").kind).toBe("site");
    expect(() => world.stateOf("ghost")).toThrow(/no entity/);
    expect(() => world.stateAs("srv-a1", "rack")).toThrow(/not a rack/);
  });

  test("commands become numbered, timed events with their cause", () => {
    const world = fresh();
    world.advance(30);
    const event = world.apply({ type: "power.set", target: "srv-a1", on: false }, "tool:redfish");
    expect(event).toMatchObject({ seq: 1, t: 30, cause: "tool:redfish", type: "power.set" });
    expect(world.stateAs("srv-a1", "server").adminOn).toBe(false);
    world.apply({ type: "note", text: "hello" }, "scenario");
    expect(world.events().map((x) => x.seq)).toEqual([1, 2]);
    expect(world.events(1).map((x) => x.type)).toEqual(["note"]);
    expect(() => world.advance(-1)).toThrow(/backwards/);
  });

  test.each([
    [{ type: "power.set", target: "rack-a", on: false }, /cannot be powered/],
    [{ type: "load.set", target: "rack-a", value: 0.5 }, /only be set/],
    [{ type: "load.set", target: "srv-a1", value: 1.5 }, /between 0 and 1/],
    [{ type: "setpoint.set", target: "crah-1", celsius: 40 }, /between 16 and 27/],
    [{ type: "breaker.reset", target: "srv-a1" }, /no breaker/],
    [{ type: "thermal.shutdown", target: "rack-a" }, /not a server/],
    [{ type: "fault.remove", faultId: "nope" }, /no active fault/],
    [
      { type: "fault.add", fault: { id: "f", type: "fan_failure", target: "crah-1", params: {} } },
      /cannot target a cooling_unit/,
    ],
    [
      {
        type: "fault.add",
        fault: { id: "f", type: "cooling_unit_degraded", target: "crah-1", params: { factor: 2 } },
      },
      /between/,
    ],
  ] as const)("invalid command %o is refused", (command, message) => {
    expect(() => fresh().apply(command as never, "test")).toThrow(message);
  });

  test("loads, setpoints and shutdowns change state", () => {
    const world = fresh();
    world.apply({ type: "load.set", target: "srv-a1", value: 0.9 }, "scenario");
    world.apply({ type: "load.set", target: "vm-db", value: 0.7 }, "scenario");
    world.apply({ type: "setpoint.set", target: "crah-1", celsius: 18 }, "tool");
    world.apply({ type: "thermal.shutdown", target: "srv-b1" }, "physics");
    expect(world.stateAs("srv-a1", "server").cpuUtil).toBe(0.9);
    expect(world.stateAs("vm-db", "vm").cpuDemand).toBe(0.7);
    expect(world.stateAs("crah-1", "cooling_unit").setpointC).toBe(18);
    expect(world.stateAs("srv-b1", "server")).toMatchObject({ adminOn: false, health: "critical" });
  });

  test("faults get default parameters and immediate effects, which removal undoes", () => {
    const world = fresh();
    const linkId = world.index.outgoing("srv-a1", "network")[0]?.id as string;
    world.apply(
      {
        type: "fault.add",
        fault: { id: "f1", type: "cooling_unit_degraded", target: "crah-1", params: {} },
      },
      "scenario",
    );
    world.apply(
      { type: "fault.add", fault: { id: "f2", type: "breaker_trip", target: "pdu-a", params: {} } },
      "scenario",
    );
    world.apply(
      { type: "fault.add", fault: { id: "f3", type: "grid_outage", target: "ups-1", params: {} } },
      "scenario",
    );
    world.apply(
      { type: "fault.add", fault: { id: "f4", type: "link_down", target: linkId, params: {} } },
      "scenario",
    );
    expect(world.faultsOn("crah-1")[0]?.params).toEqual({ factor: 0.4 });
    expect(world.stateAs("pdu-a", "pdu").tripped).toBe(true);
    expect(world.stateAs("ups-1", "ups").inputOk).toBe(false);
    expect(world.linkUp(linkId)).toBe(false);
    expect(() =>
      world.apply(
        {
          type: "fault.add",
          fault: { id: "f1", type: "cooling_unit_failure", target: "crah-1", params: {} },
        },
        "x",
      ),
    ).toThrow(/already active/);
    for (const id of ["f2", "f3", "f4"])
      world.apply({ type: "fault.remove", faultId: id }, "scenario");
    expect(world.stateAs("pdu-a", "pdu").tripped).toBe(false);
    expect(world.stateAs("ups-1", "ups").inputOk).toBe(true);
    expect(world.linkUp(linkId)).toBe(true);
    expect(world.faults().map((f) => f.id)).toEqual(["f1"]);
  });

  test("resetting a breaker clears its trip fault", () => {
    const world = fresh();
    world.apply(
      {
        type: "fault.add",
        fault: { id: "trip", type: "breaker_trip", target: "panel-1", params: {} },
      },
      "scenario",
    );
    world.apply({ type: "breaker.reset", target: "panel-1" }, "tool:reset_breaker");
    expect(world.stateAs("panel-1", "power_panel").tripped).toBe(false);
    expect(world.faults()).toEqual([]);
  });

  test("alarms are raised and cleared through events", () => {
    const world = fresh();
    const alarm = {
      id: "a1",
      entityId: "srv-a1",
      code: "inlet_high",
      severity: "warning" as const,
      message: "hot",
      since: 0,
    };
    world.apply({ type: "alarm.raise", alarm }, "physics");
    expect(world.alarms()).toEqual([alarm]);
    world.apply({ type: "alarm.clear", alarmId: "a1" }, "physics");
    expect(world.alarms()).toEqual([]);
  });

  test("a snapshot restores state, time and the event log exactly", () => {
    const world = fresh();
    world.apply({ type: "load.set", target: "srv-a1", value: 0.5 }, "scenario");
    world.advance(10);
    const snap = world.snapshot();
    world.apply({ type: "power.set", target: "srv-a1", on: false }, "tool");
    world.patch("srv-a1", "server", { inletC: 40 });
    world.advance(100);
    world.restore(snap);
    expect(world.time()).toBe(10);
    expect(world.stateAs("srv-a1", "server")).toMatchObject({
      adminOn: true,
      inletC: 22,
      cpuUtil: 0.5,
    });
    expect(world.events().map((x) => x.seq)).toEqual([1]);
    expect(world.apply({ type: "note", text: "after" }, "x").seq).toBe(2);
    world.patch("srv-a1", "server", { inletC: 30 });
    expect(snap.state.entities["srv-a1"]).toMatchObject({ inletC: 22 });
  });

  test("the same commands on the same blueprint give the same state", () => {
    const run = () => {
      const world = fresh();
      for (const [i, value] of [0.2, 0.9, 0.4].entries()) {
        world.advance(15);
        world.apply({ type: "load.set", target: i % 2 ? "srv-a1" : "srv-b1", value }, "scenario");
      }
      return { state: world.snapshot().state, events: world.events() };
    };
    expect(run()).toEqual(run());
  });

  test("a read-only port reads everything and refuses every command", () => {
    const world = fresh();
    const port = new ReadOnlyWorldPort(world);
    expect(port.index).toBe(world.index);
    expect(port.catalog).toBe(world.catalog);
    expect(port.stateAs("srv-a1", "server").adminOn).toBe(true);
    expect(port.stateOf("rack-a").kind).toBe("rack");
    expect([port.time(), port.faults(), port.faultsOn("x"), port.alarms(), port.events()]).toEqual([
      0,
      [],
      [],
      [],
      [],
    ]);
    expect(port.linkUp("nope")).toBe(true);
    expect(() => port.apply({ type: "power.set", target: "srv-a1", on: false })).toThrow(
      /read-only/,
    );
  });
});

describe("fault catalog [REQ-005] [REQ-034]", () => {
  test("every fault has a label, targets and sane parameter ranges", () => {
    expect(FAULT_SPECS.length).toBeGreaterThanOrEqual(15);
    for (const spec of FAULT_SPECS) {
      expect(spec.label.length).toBeGreaterThan(1);
      expect(spec.targets.length).toBeGreaterThan(0);
      for (const param of spec.params)
        expect(param.min <= param.default && param.default <= param.max).toBe(true);
    }
    expect(faultSpec("grid_outage").targets).toEqual(["ups"]);
    expect(isFaultType("grid_outage")).toBe(true);
    expect(isFaultType("meteor")).toBe(false);
  });
});
