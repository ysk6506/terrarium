import { DOMAIN_TEMPLATES } from "@terrarium/core/scenario";
import { TOOL_SPECS, toolsForDomains } from "@terrarium/core/tools";
import { BlueprintIndex, type Domain } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { serviceLab } from "../world/test-support/service-lab";
import { Session } from ".";

const H = 3600;
const MINE: Domain[] = ["service_os", "virtualization"];
const blueprint = serviceLab();
const index = new BlueprintIndex(blueprint);
const memory = DOMAIN_TEMPLATES[0] as (typeof DOMAIN_TEMPLATES)[number];

function open(domains: Domain[] = MINE): Session {
  const s = Session.create({
    blueprint,
    scenario: memory.build(index, blueprint.id),
    tools: toolsForDomains(domains, TOOL_SPECS),
    domains,
    seed: 3,
  });
  s.start();
  return s;
}

/** Wait until the last fault of the hand-offs is gone, to the minute; returns the world time it was. */
function waitDone(s: Session): number {
  const dones = s
    .eventsSince(0)
    .flatMap((e) =>
      e.kind === "counterpart" && e.what === "handed" ? e.faults.map((f) => f.doneAt) : [],
    );
  const doneAt = Math.max(...dones);
  while (s.world.time() < doneAt + 1 && s.status === "running")
    s.call("wait", { seconds: Math.max(1, Math.min(H, Math.ceil(doneAt + 1 - s.world.time()))) });
  return doneAt;
}

const bridge = (s: Session) => {
  s.call("migrate_vm", { vm: "vm-db", host: "srv-b1" });
  s.call("failover_service", { service: "svc-license" });
  s.call("wait", { seconds: 300 });
};

describe("what the run did with the wait is read from the record [REQ-093]", () => {
  test("an agent that moves the services meanwhile and puts them back after: bridged, cleaned up, little late", () => {
    const s = open();
    s.call("escalate", { domain: "server" });
    bridge(s);
    waitDone(s);
    s.call("migrate_vm", { vm: "vm-db", host: "srv-a2" });
    s.call("failover_service", { service: "svc-license" });
    const result = s.finish();
    const row = result.score.handoff?.rows[0];
    expect(result.score.handoff).toMatchObject({ count: 1, faults: 1, needless: 0, penalty: 0 });
    expect(row?.bridge.acted).toBe(true);
    expect(row?.bridge.impaired).toBeGreaterThan(0);
    expect(row?.bridge.savedAfterSeconds).toBeLessThan(15 * 60);
    expect(row?.cleanup).toMatchObject({ needed: 2, done: 2 });
    expect(row?.cleanup.lateSeconds).toBeLessThan(5 * 60);
  });

  test("an agent that only waits has no temporary measure; the services stay stopped for the whole wait and the score shows it", () => {
    const waiting = open();
    waiting.call("escalate", { domain: "server" });
    const doneAt = waitDone(waiting);
    const slow = waiting.finish();
    expect(slow.score.handoff?.rows[0]?.bridge).toMatchObject({ acted: false });
    expect(slow.score.handoff?.rows[0]?.bridge.savedAfterSeconds).toBeUndefined();
    expect(slow.score.recovery?.agentSeconds).toBeGreaterThan(doneAt / 2);

    const quick = open();
    quick.call("escalate", { domain: "server" });
    bridge(quick);
    waitDone(quick);
    const fast = quick.finish();
    expect(fast.score.recovery?.agentSeconds).toBeLessThan(15 * 60);
    expect(fast.score.recovery?.agentSeconds).toBeLessThan(
      (slow.score.recovery?.agentSeconds ?? 0) / 20,
    );
    expect(fast.score.earned).toBeGreaterThan(slow.score.earned);
    const timeAxis = (r: typeof fast) => r.score.items.find((i) => i.id === "recovery_time");
    expect(timeAxis(slow)?.points).toBe(0);
    expect(timeAxis(fast)?.points).toBeGreaterThan(0);
  });

  test("a move that is never put back, and one put back an hour late, are told apart", () => {
    const forgot = open();
    forgot.call("escalate", { domain: "server" });
    bridge(forgot);
    waitDone(forgot);
    expect(forgot.finish().score.handoff?.rows[0]?.cleanup).toMatchObject({ needed: 2, done: 0 });

    const late = open();
    late.call("escalate", { domain: "server" });
    bridge(late);
    waitDone(late);
    late.call("wait", { seconds: H });
    late.call("migrate_vm", { vm: "vm-db", host: "srv-a2" });
    const cleanup = late.finish().score.handoff?.rows[0]?.cleanup;
    expect(cleanup).toMatchObject({ needed: 2, done: 1 });
    expect(cleanup?.lateSeconds).toBeGreaterThanOrEqual(H);
  });

  test("an alarm that comes up during the wait counts as looked after only when the agent looks at what it is on", () => {
    const attend = open();
    attend.call("escalate", { domain: "server" });
    attend.world.apply(
      {
        type: "fault.add",
        fault: { id: "f-cpu", type: "cpu_runaway", target: "srv-b1", params: {} },
      },
      "scenario:test",
    );
    attend.call("wait", { seconds: 600 });
    attend.call("get_entity", { id: "srv-b1" });
    waitDone(attend);
    const seen = attend.finish().score.handoff?.rows[0]?.meanwhile;
    expect(seen?.alarms).toBeGreaterThan(0);
    expect(seen?.looked).toBeGreaterThan(0);

    const ignore = open();
    ignore.call("escalate", { domain: "server" });
    ignore.world.apply(
      {
        type: "fault.add",
        fault: { id: "f-cpu", type: "cpu_runaway", target: "srv-b1", params: {} },
      },
      "scenario:test",
    );
    waitDone(ignore);
    const missed = ignore.finish().score.handoff?.rows[0]?.meanwhile;
    expect(missed?.alarms).toBeGreaterThan(0);
    expect(missed?.looked).toBe(0);
  });

  test("handing over a fault the agent's own tools could fix costs points; handing over a fault of another domain does not", () => {
    const s = open();
    s.world.apply(
      {
        type: "fault.add",
        fault: { id: "f-disk", type: "disk_full", target: "vm-web", params: {} },
      },
      "scenario:test",
    );
    s.call("escalate", { domain: "service_os" });
    s.call("escalate", { domain: "server" });
    const result = s.finish();
    expect(result.score.handoff).toMatchObject({ count: 2, faults: 2, needless: 1, penalty: 5 });
    const item = result.score.items.find((i) => i.id === "handoff-needless");
    expect(item).toMatchObject({ verdict: "penalty", points: -5 });
    expect(result.score.handoff?.rows.map((r) => r.faults.map((f) => f.needless))).toEqual([
      [true],
      [false],
    ]);
  });

  test("a hand-off with nothing in it counts as handed over for no reason, and the run says what domains it had", () => {
    const s = open();
    s.call("escalate", { domain: "facility" });
    const result = s.finish();
    expect(result.score.handoff).toMatchObject({ count: 1, faults: 0, needless: 1 });
    expect(result.scope).toMatchObject({
      domains: MINE,
      leadTimesLabel: "기본값",
    });
    const plain = Session.create({
      blueprint,
      scenario: memory.build(index, blueprint.id),
      tools: toolsForDomains([], TOOL_SPECS),
      seed: 1,
    });
    plain.start();
    expect(plain.finish().scope).toBeUndefined();
  });
});

describe("the experiment's vendor SLA, spare parts and surcharge change the wait [REQ-093]", () => {
  const etaWith = (leadTimes: Parameters<typeof Session.create>[0]["leadTimes"]): number => {
    const s = Session.create({
      blueprint,
      scenario: memory.build(index, blueprint.id),
      tools: toolsForDomains(MINE, TOOL_SPECS),
      domains: MINE,
      seed: 3,
      ...(leadTimes ? { leadTimes } : {}),
    });
    s.start();
    const r = s.call("escalate", { domain: "server" });
    return (r.data as { faults: Array<{ etaSeconds: number }> }).faults[0]?.etaSeconds as number;
  };

  test("no spare is slower than a spare, and a four-hour contract is faster than a three-day one", () => {
    const stock = etaWith({ spares: "yes" });
    const ordered = etaWith({ spares: "no" });
    expect(ordered).toBeGreaterThan(stock);
    expect(etaWith({ spares: "no", vendorSla: "4h" })).toBeLessThan(ordered);
    expect(etaWith({ spares: "no", vendorSla: "3d" })).toBeGreaterThan(ordered);
    expect(etaWith({ start: "weekend" })).toBeGreaterThan(
      etaWith({ afterHours: false, start: "weekend" }),
    );
    expect(etaWith(undefined)).toBe(etaWith({}));
  });

  test("the result keeps which settings the run had", () => {
    const s = Session.create({
      blueprint,
      scenario: memory.build(index, blueprint.id),
      tools: toolsForDomains(MINE, TOOL_SPECS),
      domains: MINE,
      leadTimes: { spares: "no", vendorSla: "4h" },
      seed: 3,
    });
    s.start();
    expect(s.finish().scope?.leadTimesLabel).toBe(
      "벤더 4시간 · 예비 부품 모두 없음 · 야간·주말 ×1.5 · 평일 낮에 시작",
    );
  });
});
