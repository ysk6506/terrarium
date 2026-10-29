/** The tools against the campus sample: liquid cooling, a plant and a generator are part of the cascade. */
import { Catalog } from "@terrarium/core/catalog";
import type { Facades } from "@terrarium/core/facades";
import { World } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { campusBlueprint } from "../world/test-support/sample-campus";
import { dependencies, dependents, TOOL_NAMES, Toolbox, type ToolContext } from ".";

const nothing = { handle: () => ({ status: 404, headers: {}, body: {} }) };
const facades = { redfish: nothing, vcenter: nothing, vrops: nothing } as unknown as Facades;

function setup() {
  const world = World.fromBlueprint(campusBlueprint(), new Catalog());
  world.advance(600);
  const ctx: ToolContext = { world, facades };
  return { world, ctx, tools: new Toolbox(TOOL_NAMES) };
}

describe("tools follow liquid cooling and the power chain [REQ-044] [REQ-046]", () => {
  test("losing the chiller loses the CDU, and with it the liquid-cooled and immersed servers", () => {
    const { ctx } = setup();
    const lost = dependents(ctx, "chiller-1");
    expect(lost).toEqual(expect.arrayContaining(["cdu-1", "rack-l", "tank-1", "srv-l1", "srv-t1"]));
    // The air-cooled hall does not depend on the chiller: its units have their own compressors.
    expect(lost).not.toContain("srv-a1");
  });

  test("losing the generator or the transfer switch loses what hangs on them, the plant included", () => {
    const { ctx } = setup();
    for (const source of ["gen-1", "ats-1"]) {
      const lost = dependents(ctx, source);
      expect(lost).toEqual(
        expect.arrayContaining(["ups-2", "chiller-1", "cdu-1", "srv-l1", "srv-t1"]),
      );
    }
    expect(dependencies(ctx, "srv-l1")).toEqual(
      expect.arrayContaining(["ups-2", "ats-1", "gen-1", "cdu-1", "chiller-1"]),
    );
  });

  test("'A affects B' holds exactly when 'B depends on A', for every pair of devices in the campus", () => {
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
    expect(devices.length).toBeGreaterThan(20);
    expect(mismatches).toEqual([]);
  });

  test("facility_status shows the plant behind a room: CDUs, chillers and generators", () => {
    const { tools, ctx } = setup();
    const result = tools.call("facility_status", { roomId: "hall" }, ctx);
    const [hall] = result.data as any[];
    expect(hall.cdus.map((c: any) => c.id)).toEqual(["cdu-1"]);
    expect(hall.chillers.map((c: any) => c.id)).toEqual(["chiller-1"]);
    expect(hall.generators.map((c: any) => c.id)).toEqual(["gen-1"]);
    expect(hall.panels.map((c: any) => c.id)).toEqual(expect.arrayContaining(["panel-1", "ats-1"]));
  });
});
