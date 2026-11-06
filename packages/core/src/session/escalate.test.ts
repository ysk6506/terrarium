import { DOMAIN_TEMPLATES } from "@terrarium/core/scenario";
import { callEffect, TOOL_SPECS, toolsForDomains } from "@terrarium/core/tools";
import {
  BlueprintIndex,
  type CounterpartEvent,
  type Domain,
  type Fault,
} from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { serviceLab } from "../world/test-support/service-lab";
import { Session, type SessionConfig } from ".";

const MINE: Domain[] = ["service_os", "virtualization"];
const H = 3600;

const [memory, port] = DOMAIN_TEMPLATES;
const blueprint = serviceLab();
const index = new BlueprintIndex(blueprint);

function open(over: Partial<SessionConfig> = {}, template = memory): Session {
  const s = Session.create({
    blueprint,
    scenario: template?.build(index, blueprint.id) as never,
    tools: [...toolsForDomains(MINE, TOOL_SPECS), "create_ticket", "update_ticket", "list_tickets"],
    domains: MINE,
    seed: 3,
    ...over,
  });
  s.start();
  return s;
}

const data = (s: Session, tool: string, args: Record<string, unknown> = {}) => {
  const r = s.call(tool, args);
  expect(r.error, `${tool} ${JSON.stringify(args)}`).toBeUndefined();
  return r.data as any;
};

const waitHours = (s: Session, hours: number) => {
  for (let i = 0; i < hours && s.status === "running"; i++) s.call("wait", { seconds: H });
};

const counterpartEvents = (s: Session): CounterpartEvent[] =>
  s.eventsSince(0).filter((e): e is CounterpartEvent => e.kind === "counterpart");

const addFault = (s: Session, fault: Omit<Fault, "since">) =>
  s.world.apply({ type: "fault.add", fault }, "scenario:test");

describe("escalate hands a domain's faults to its team [REQ-093]", () => {
  test("the faults in the domain at that moment get a wait each; the answer says which team and how long", () => {
    const s = open();
    addFault(s, { id: "f-fan", type: "fan_failure", target: "srv-a1", params: {} });
    addFault(s, { id: "f-disk", type: "disk_full", target: "vm-web", params: {} });
    const answer = data(s, "escalate", { domain: "server", note: "메모리 오류가 올라와요" });
    expect(answer.team).toBe("서버 팀");
    expect(answer.faults.map((f: { type: string }) => f.type).sort()).toEqual([
      "fan_failure",
      "memory_failure",
    ]);
    expect(answer.message).toMatch(/^서버 팀에 넘겼어요 · 고장 2개 · 예상 .+ \/ .+$/);
    for (const f of answer.faults) {
      expect(f.etaSeconds % 600).toBe(0);
      expect(f.eta).toMatch(/시간|분|일/);
    }
    // the operating-system fault is another team's and stays
    expect(s.world.faults().map((f) => f.id)).toContain("f-disk");
  });

  test("a fault that appears after the hand-off is not in it; a name that is not a domain is a plain error", () => {
    const s = open();
    const bad = s.call("escalate", { domain: "hvac" });
    expect(bad.ok).toBe(false);
    expect(bad.error).toMatch(
      /^가능한 도메인: service_os \(서비스\/OS\), virtualization \(가상화\), server \(서버\)/,
    );
    expect(s.world.faults().length).toBe(1);

    data(s, "escalate", { domain: "server" });
    addFault(s, { id: "f-late", type: "psu_failure", target: "srv-b1", params: {} });
    waitHours(s, 90);
    const ids = s.world.faults().map((f) => f.id);
    expect(ids).toContain("f-late");
    expect(ids).not.toContain("scn:fault");
    const again = data(s, "escalate", { domain: "server" });
    expect(again.faults.map((f: { fault: string }) => f.fault)).toEqual(["f-late"]);
  });

  test("a domain with no fault in it is still a hand-off, and says so", () => {
    const s = open();
    const answer = data(s, "escalate", { domain: "facility" });
    expect(answer.faults).toEqual([]);
    expect(answer.message).toBe("데이터센터 인프라 팀에 넘겼어요 · 지금 이 도메인에 고장이 없어요");
  });

  test("the same seed gives the same waits; other seeds give other waits, always inside the range of the kind", () => {
    const etas = (seed: number) =>
      data(open({ seed }), "escalate", { domain: "server" }).faults[0].etaSeconds;
    expect(etas(11)).toBe(etas(11));
    const all = [1, 2, 3, 4, 5, 6, 7, 8].map(etas);
    expect(new Set(all).size).toBeGreaterThan(3);
    for (const v of all) {
      expect(v).toBeGreaterThanOrEqual(4 * H);
      expect(v).toBeLessThanOrEqual(3 * 86_400);
    }
  });

  test("two faults on one machine are fixed in one visit, so they are gone together", () => {
    const s = open();
    addFault(s, { id: "f-fan", type: "fan_failure", target: "srv-a2", params: {} });
    const answer = data(s, "escalate", { domain: "server" });
    const [a, b] = answer.faults;
    expect(a.etaSeconds).toBe(b.etaSeconds);
  });
});

describe("the other side's progress is in the record [REQ-093]", () => {
  test("handed, started on site half an hour before the end, done; the fault is gone and the services come back", () => {
    const s = open();
    const handed = data(s, "escalate", { domain: "server" }).faults[0];
    waitHours(s, Math.ceil(handed.etaSeconds / H) + 1);
    const events = counterpartEvents(s);
    expect(events.map((e) => e.what)).toEqual(["handed", "started", "done"]);
    const [, started, done] = events as [CounterpartEvent, CounterpartEvent, CounterpartEvent];
    expect(done.t - started.t).toBe(30 * 60);
    expect(started).toMatchObject({
      team: "벤더",
      fault: { onSite: true, kind: "replace", target: "srv-a2" },
    });
    expect(started.summary).toContain("도착했어요");
    expect(done.t).toBe((events[0] as CounterpartEvent).t + handed.etaSeconds);
    expect(s.world.faults()).toEqual([]);
    const services = data(s, "list_services") as Array<{ status: string }>;
    expect(services.every((x) => x.status === "healthy")).toBe(true);
    // what the team did to the world is not something the agent did
    const result = s.finish();
    expect(
      result.toolCalls.flatMap((c) => c.effects ?? []).filter((e) => e.target === "srv-a2"),
    ).toEqual([]);
    expect(result.events?.some((e) => e.kind === "world" && e.cause === "counterpart:server")).toBe(
      true,
    );
  });

  test("events_since gives what is new since the cursor: alarms and the team, never the faults themselves", () => {
    const s = open();
    const first = data(s, "events_since", { cursor: 0 });
    expect(first.events.map((e: { type: string }) => e.type)).not.toContain("fault");
    data(s, "escalate", { domain: "server" });
    const next = data(s, "events_since", { cursor: first.cursor });
    expect(next.events).toEqual([expect.objectContaining({ type: "handed", domain: "server" })]);
    const empty = data(s, "events_since", { cursor: next.cursor });
    expect(empty.events).toEqual([]);
    waitHours(s, 80);
    const later = data(s, "events_since", { cursor: next.cursor });
    const types = later.events.map((e: { type: string }) => e.type);
    expect(types).toEqual(expect.arrayContaining(["started", "done", "alarm_cleared"]));
    expect(JSON.stringify(later)).not.toContain('memory_failure"}');
    expect(later.events.every((e: { t: number }) => typeof e.t === "number")).toBe(true);
  });

  test("a part that was changed in a machine that had shut itself down leaves it running again", () => {
    const s = open();
    s.world.apply({ type: "thermal.shutdown", target: "srv-a2" }, "physics");
    expect(s.world.stateAs("srv-a2", "server").adminOn).toBe(false);
    data(s, "escalate", { domain: "server" });
    waitHours(s, 80);
    expect(s.world.stateAs("srv-a2", "server").adminOn).toBe(true);
    const off = open();
    off.call("wait", { seconds: 60 });
    off.world.apply({ type: "power.set", target: "srv-a2", on: false }, "tool:power_server");
    data(off, "escalate", { domain: "server" });
    waitHours(off, 80);
    expect(off.world.stateAs("srv-a2", "server").adminOn).toBe(false);
  });
});

describe("the experiment's domains decide the tools [REQ-093]", () => {
  test("its own domains' tools and the common ones stay, the rest go, and escalate with events_since come on", () => {
    const s = open();
    const names = s.toolSpecs().map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "run_command",
        "migrate_vm",
        "list_alarms",
        "escalate",
        "events_since",
        "submit_diagnosis",
      ]),
    );
    for (const gone of ["redfish_request", "network_cli", "reset_breaker", "set_cooling_setpoint"])
      expect(names).not.toContain(gone);
    const refused = s.call("reset_breaker", { id: "pdu-a" });
    expect(refused).toMatchObject({ ok: false, error: expect.stringContaining("not available") });
    const owner = Session.create({
      blueprint,
      scenario: memory?.build(index, blueprint.id) as never,
      tools: toolsForDomains([], TOOL_SPECS),
      seed: 1,
    });
    expect(owner.toolSpecs().map((t) => t.name)).toContain("redfish_request");
  });

  test("the ticket tools are optional and off unless picked; they note things and change nothing in the world", () => {
    const optional = TOOL_SPECS.filter((t) => t.optional).map((t) => t.name);
    expect(optional).toEqual(
      expect.arrayContaining([
        "create_ticket",
        "update_ticket",
        "list_tickets",
        "escalate",
        "events_since",
      ]),
    );
    const ticket = TOOL_SPECS.find((t) => t.name === "create_ticket");
    expect(ticket?.help).toBe(
      "하네스에 할 일 관리가 없을 때 켜요. 켜면 넘긴 요청이 자동으로 '기다리는 중' 티켓이 돼요. 꺼도 상대의 진행·완료는 `events_since`로 들어와요.",
    );
    expect(ticket?.bundle?.label).toBe("작업 티켓(선택)");
    for (const name of ["create_ticket", "update_ticket", "list_tickets"])
      expect(callEffect(name, {})).toBe("observe");
    expect(callEffect("escalate", { domain: "server" })).toBe("act");
  });
});

describe("work tickets [REQ-093]", () => {
  test("with the tools on, a hand-off is a waiting ticket by itself, and it comes back to the agent when the team is done", () => {
    const s = open();
    data(s, "escalate", { domain: "server" });
    const [t] = data(s, "list_tickets");
    expect(t).toMatchObject({
      status: "waiting",
      waitingFor: "서버 팀",
      handoff: "h1",
      title: "서버 팀에 넘긴 일",
    });
    expect(t.dueAt).toBeGreaterThan(s.world.time());
    waitHours(s, 80);
    const [after] = data(s, "list_tickets");
    expect(after).toMatchObject({ status: "mine" });
    expect(after.note).toContain("되돌려요");
    const closed = data(s, "update_ticket", { id: after.id, status: "done" });
    expect(closed.status).toBe("done");
    expect(data(s, "list_tickets", { status: "done" })).toHaveLength(1);
    const events = s.finish().events ?? [];
    const kinds = events.flatMap((e) =>
      e.kind === "ticket" ? [`${e.what}:${e.ticket.status}:${e.auto}`] : [],
    );
    expect(kinds).toEqual(["created:waiting:true", "updated:mine:true", "updated:done:false"]);
  });

  test("the agent can write its own tickets; a ticket that does not exist is an error; without the tools nothing is made", () => {
    const s = open();
    const made = data(s, "create_ticket", {
      title: "VM 되돌리기",
      status: "waiting",
      waitingFor: "서버 팀",
      dueInSeconds: 3600,
    });
    expect(made).toMatchObject({ id: "t1", status: "waiting", waitingFor: "서버 팀" });
    expect(s.call("update_ticket", { id: "t9", status: "done" }).error).toContain("no ticket 't9'");
    expect(s.call("create_ticket", { title: " " }).ok).toBe(false);
    const bare = open({ tools: toolsForDomains(MINE, TOOL_SPECS) });
    data(bare, "escalate", { domain: "server" });
    expect(bare.call("list_tickets").ok).toBe(false);
    const events = bare.finish().events ?? [];
    expect(events.some((e) => e.kind === "ticket")).toBe(false);
  });
});

describe("the templates whose cause is outside the agent's domain [REQ-093]", () => {
  test("both are built for the lab world, name the domain of the cause and the domains to play them in", () => {
    expect(DOMAIN_TEMPLATES.map((t) => [t.id, t.causeDomain, t.scoring])).toEqual([
      ["domain-memory-vendor", "server", "recovery"],
      ["domain-port-network", "network", "recovery"],
    ]);
    for (const t of DOMAIN_TEMPLATES) {
      expect(t.unavailable(index)).toBeUndefined();
      expect(t.ownDomains).toEqual(MINE);
      expect(t.summary).not.toContain("장애");
    }
  });

  test("memory: handed to the server team the vendor takes a day, and a VM moved meanwhile brings its service back at once", () => {
    const s = open();
    expect(
      data(s, "list_services").filter((x: { status: string }) => x.status !== "healthy").length,
    ).toBeGreaterThan(0);
    const handed = data(s, "escalate", { domain: "server" });
    expect(handed.faults[0].who).toBe("vendor");
    expect(handed.faults[0].etaSeconds).toBeGreaterThanOrEqual(4 * H);
    data(s, "migrate_vm", { vm: "vm-db", host: "srv-b1" });
    s.call("wait", { seconds: 600 });
    const queue = data(s, "service_status", { service: "svc-queue" });
    expect(queue.status).toBe("healthy");
  });

  test("port: the network team clears a down link in hours; failing the service over keeps it up meanwhile", () => {
    const s = open({}, port);
    expect(s.world.faults().map((f) => f.type)).toEqual(["link_down"]);
    const handed = data(s, "escalate", { domain: "network" });
    expect(handed.team).toBe("네트워크 팀");
    expect(handed.faults[0].etaSeconds).toBeLessThanOrEqual(86_400 * 1.5);
    waitHours(s, 40);
    expect(s.world.faults()).toEqual([]);
  });
});
