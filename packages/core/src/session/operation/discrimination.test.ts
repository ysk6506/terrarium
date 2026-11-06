import { describe, expect, test } from "vitest";
import { serviceLab } from "../../world/test-support/service-lab";
import { Session } from "..";
import {
  DEFAULT_OPERATION,
  type OperationConfig,
  type OperationMetrics,
  operationScenario,
} from ".";
import { type FakeAgent, makeFakeAgents, playShift } from "./fake-agents";

const blueprint = serviceLab();

/** Eight hours in fast forward, with faults that reach the services. */
const config: OperationConfig = {
  ...DEFAULT_OPERATION,
  hours: 8,
  pace: { mode: "fast", speed: 30 },
  source: {
    kind: "set",
    faults: [
      { type: "kernel_panic", target: "srv-a2" },
      { type: "process_crashloop", target: "vm-web" },
      { type: "disk_full", target: "vm-db" },
      { type: "memory_leak", target: "srv-a1" },
      { type: "fan_failure", target: "srv-b1" },
    ],
  },
};

function shift(who: FakeAgent): OperationMetrics {
  const s = Session.create({
    blueprint,
    scenario: operationScenario("op", blueprint.id, config),
    tools: ["events_since", "list_alarms", "service_status", "wait", "get_entity"],
    seed: 11,
    operation: config,
  });
  s.start();
  playShift(s, who);
  return (s.finish().operation as NonNullable<ReturnType<Session["finish"]>["operation"]>).metrics;
}

describe("the fake agents line up as the measures intend [REQ-090]", () => {
  const agents = makeFakeAgents();
  const m = {
    idle: shift(agents.idle),
    watcher: shift(agents.watcher),
    fixer: shift(agents.fixer),
    frantic: shift(agents.frantic),
  };

  test("an agent that does nothing misses every alarm and never detects a fault", () => {
    expect(m.idle.alarms).toBeGreaterThan(0);
    expect(m.idle.missed).toBe(m.idle.alarms);
    expect(m.idle.undetected).toBe(m.idle.incidents);
    expect(m.idle.calls).toBe(0);
  });

  test("looking every five minutes misses (almost) nothing and detects within minutes", () => {
    expect(m.watcher.missed).toBeLessThan(m.idle.missed);
    expect(m.watcher.detectionDelayS as number).toBeLessThan(600);
    expect(m.watcher.watchIntervalS as number).toBeGreaterThan(200);
  });

  test("looking and fixing raises availability and ends incidents", () => {
    expect(m.fixer.availability as number).toBeGreaterThan(m.watcher.availability as number);
    expect(m.fixer.availability as number).toBeGreaterThan(m.idle.availability as number);
    expect(m.fixer.open).toBeLessThan(m.watcher.open);
    expect(m.fixer.recovery?.median as number).toBeLessThan(8 * 3600);
  });

  test("looking every minute from three angles detects sooner but costs several times more, mostly when quiet", () => {
    expect(m.frantic.detectionDelayS as number).toBeLessThanOrEqual(
      m.fixer.detectionDelayS as number,
    );
    expect(m.frantic.missed).toBeLessThanOrEqual(m.fixer.missed);
    expect(m.frantic.calls).toBeGreaterThan(m.fixer.calls * 3);
    expect(m.frantic.quietCalls).toBeGreaterThan(m.fixer.quietCalls * 3);
    expect(m.frantic.watchIntervalS as number).toBeLessThan(m.fixer.watchIntervalS as number);
  });
});
