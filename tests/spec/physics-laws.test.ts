/**
 * [REQ-113] Every built-in world, run for a simulated day on the default physics (v1), breaks none of the physics laws
 * (ADR-0137, docs/design-docs/physics-laws.md): energy in a room balances, cooling removes no more than it can, a battery
 * gives no more than the load took, a supplier carries what its consumers draw, a device draws between idle and maximum.
 * What v1 is known to break is named in `KNOWN_V1_EXCEPTIONS`, with the reason, and is left for v2 (fixing it here would
 * move the numbers `physics-golden.test.ts` holds).
 */
import { Catalog } from "@terrarium/core/catalog";
import { KNOWN_V1_EXCEPTIONS, LawMonitor, Physics } from "@terrarium/core/physics";
import { World } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { PHYSICS_WORLDS } from "./test-support/physics-worlds";

const catalog = new Catalog();
const DAY_S = 86_400;
const STEP_S = 10;

describe("every built-in world keeps the physics laws for a simulated day on the default physics [REQ-113]", () => {
  test.each(PHYSICS_WORLDS)(
    "%s",
    (_name, make) => {
      const world = World.fromBlueprint(make(), catalog);
      const physics = new Physics(world);
      physics.settle();
      const monitor = new LawMonitor(world);
      for (let t = 0; t < DAY_S; t += STEP_S) {
        physics.step(STEP_S);
        monitor.observe(STEP_S);
      }
      monitor.detach();
      const report = monitor.report();
      expect(report.steps).toBe(DAY_S / STEP_S);
      expect(report.failures.map((v) => `${v.law} ${v.message}`)).toEqual([]);
    },
    600_000,
  );

  test("each exception of v1 names the law and the reason", () => {
    for (const k of KNOWN_V1_EXCEPTIONS) {
      expect(k.law).toBeTruthy();
      expect(k.reason.length).toBeGreaterThan(10);
    }
  });
});
