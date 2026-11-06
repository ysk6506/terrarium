import { wallClockMs } from "@terrarium/core/kernel";
import { describe, expect, test } from "vitest";
import { serviceLab } from "../../world/test-support/service-lab";
import { Session } from "..";
import {
  DEFAULT_OPERATION,
  type OperationConfig,
  operationScenario,
  replayInputs,
  type SessionInput,
} from ".";

const blueprint = serviceLab();
const config: OperationConfig = {
  ...DEFAULT_OPERATION,
  hours: 96,
  rateScale: 40,
  budget: { maxToolCalls: 50_000 },
};
const open = (seed = 5) =>
  Session.create({
    blueprint,
    scenario: operationScenario("op", blueprint.id, config),
    tools: ["events_since", "list_alarms", "service_status", "get_entity"],
    seed,
    operation: config,
  });

/** Drive a session the way a host does and note what it was given: a sync a step, `calls` calls after each. */
function drive(
  session: Session,
  steps: number,
  calls: number,
  odd = "events_since",
): SessionInput[] {
  const given: SessionInput[] = [];
  let elapsed = 0;
  for (let i = 1; i <= steps; i++) {
    elapsed += 1.25;
    given.push(["s", elapsed]);
    session.sync(elapsed);
    for (let c = 0; c < calls; c++) {
      const args = c % 2 === 0 || odd !== "events_since" ? {} : { cursor: 0 };
      const tool = c % 2 === 0 ? "list_alarms" : odd;
      given.push(["c", tool, args]);
      session.call(tool, args);
    }
  }
  return given;
}

const target = (s: Session) => ({
  sync: (e: number) => s.sync(e),
  call: (t: string, a: Record<string, unknown>) => s.call(t, a),
  humanAct: (t: string, a: Record<string, unknown>) => s.humanAct(t, a),
  resolveHuman: (r: Parameters<Session["resolveHuman"]>[0]) => s.resolveHuman(r),
});

describe("an operation is built again from what its session was given [REQ-090]", () => {
  test("playing the inputs into a fresh session gives the same world, the same record and the same clock", () => {
    const a = open();
    a.start();
    const given = drive(a, 100, 2);
    const b = open();
    b.start();
    const last = replayInputs(target(b), given);
    expect(last).toBe(125);
    expect(b.worldTime).toBe(a.worldTime);
    expect(b.eventsSince(0)).toEqual(a.eventsSince(0));
    expect(b.status).toBe(a.status);
    // both go on the same way
    a.sync(520);
    b.sync(520);
    expect(b.eventsSince(0)).toEqual(a.eventsSince(0));
  });

  test("ten thousand events are played again in under a second", () => {
    const a = open(9);
    a.start();
    const given = drive(a, 2600, 4, "service_status");
    const events = a.eventsSince(0).length;
    expect(events).toBeGreaterThanOrEqual(10_000);
    const b = open(9);
    b.start();
    const began = wallClockMs();
    replayInputs(target(b), given);
    const took = wallClockMs() - began;
    expect(b.eventsSince(0).length).toBe(events);
    expect(took).toBeLessThan(1000);
  }, 60_000);
});
