import { DOMAIN_TEMPLATES } from "@terrarium/core/scenario";
import { Session } from "@terrarium/core/session";
import { TOOL_SPECS, toolsForDomains } from "@terrarium/core/tools";
import { BlueprintIndex, DOMAIN_IDS, type Domain } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { serviceLab } from "../../../../packages/core/src/world/test-support/service-lab";
import { experiment } from ".";
import * as h from "./handoffs";
import { domainsLine } from "./scenario/start";

const MINE: Domain[] = ["service_os", "virtualization"];
const blueprint = serviceLab();
const index = new BlueprintIndex(blueprint);
const memory = DOMAIN_TEMPLATES[0] as (typeof DOMAIN_TEMPLATES)[number];

/** A run that hands the server domain over, moves the VM and the service, waits, and puts them back. */
function run() {
  const s = Session.create({
    blueprint,
    scenario: memory.build(index, blueprint.id),
    tools: [...toolsForDomains(MINE, TOOL_SPECS), "create_ticket", "update_ticket", "list_tickets"],
    domains: MINE,
    seed: 3,
  });
  s.start();
  s.call("escalate", { domain: "server" });
  s.call("migrate_vm", { vm: "vm-db", host: "srv-b1" });
  s.call("failover_service", { service: "svc-license" });
  for (let i = 0; i < 40; i++) s.call("wait", { seconds: 3600 });
  return s.finish();
}

describe("the run page reads what was handed over from the run's events [REQ-093]", () => {
  const result = run();
  const events = result.events ?? [];
  const nameOf = (id: string) => index.find(id)?.name ?? id;

  test("each hand-off lists its faults with the wait told at the start and how far each is", () => {
    const [block] = h.handoffBlocks(events, nameOf);
    expect(block).toMatchObject({ domain: "서버", team: "서버 팀" });
    expect(block?.faults).toHaveLength(1);
    const fault = block?.faults[0];
    expect(fault).toMatchObject({ label: "메모리 불량", progress: "done", who: "벤더" });
    expect(fault?.eta).toMatch(/^1일|시간/);
    expect(fault?.doneText).toMatch(/지났을 때$/);
    const early = h.handoffBlocks(
      events.filter((e) => e.t < 3600),
      nameOf,
    )[0];
    expect(early?.faults[0]?.progress).toBe("waiting");
    expect(h.PROGRESS_LABELS.waiting).toBe("기다리는 중");
  });

  test("the board puts each ticket in the column of its latest status: waiting became mine when the team was done", () => {
    expect(h.hasTickets(events)).toBe(true);
    const board = h.ticketBoard(events);
    expect(board.waiting).toEqual([]);
    expect(board.mine).toEqual([
      expect.objectContaining({ title: "서버 팀에 넘긴 일", auto: true }),
    ]);
    expect(h.TICKET_COLUMNS.map((c) => c.label)).toEqual(["내가 할 것", "기다리는 중", "끝남"]);
    const before = h.ticketBoard(events.filter((e) => e.t < 3600));
    expect(before.waiting[0]?.detail).toContain("서버 팀를 기다려요");
  });

  test("the four measures are told in words: temporary measure, clean-up, meanwhile and the reason", () => {
    const report = result.score.handoff;
    expect(report).toBeDefined();
    const [row] = h.measureLines(report as never);
    const text = Object.fromEntries((row?.lines ?? []).map((l) => [l.label, l]));
    expect(Object.keys(text)).toEqual(["임시 조치", "마무리", "동시 작업", "넘긴 근거"]);
    expect(text["임시 조치"]?.tone).toBe("good");
    expect(text.마무리).toMatchObject({
      tone: "bad",
      value: expect.stringContaining("되돌리지 않았어요"),
    });
    expect(text["넘긴 근거"]).toMatchObject({ tone: "good" });
    expect(h.handoffSummary(report as never)).toBe("1번 넘겼어요 · 고장 1개");
  });

  test("the result says which domains the run had and which waits", () => {
    expect(result.scope).toBeDefined();
    expect(h.scopeText(result.scope as never)).toBe(
      "내 도메인 서비스/OS, 가상화 · 담당자 설정 기본값",
    );
    expect(h.scopeText({ domains: [], leadTimesLabel: "기본값" })).toContain("모든 도메인");
  });

  test("a run that handed nothing over has no blocks", () => {
    expect(h.handoffBlocks([], nameOf)).toEqual([]);
    expect(h.hasTickets([])).toBe(false);
  });
});

describe("a new experiment picks its domains and its teams' waits [REQ-093]", () => {
  test("choosing domains turns their tools on, with escalate and events_since; choosing none puts the usual set back", () => {
    const base = experiment.emptyDraft();
    const mine = experiment.setDomains(base, ["service_os", "virtualization"]);
    expect(mine.domains).toEqual(["service_os", "virtualization"]);
    expect(mine.tools).toEqual(
      expect.arrayContaining(["run_command", "migrate_vm", "escalate", "events_since"]),
    );
    expect(mine.tools).not.toContain("network_cli");
    expect(mine.tools).not.toContain("create_ticket");
    const back = experiment.setDomains(mine, []);
    expect(back.tools).not.toContain("escalate");
    expect(back.tools).toEqual(base.tools);
  });

  test("a ticket tool switched on stays on when the domains change", () => {
    const withTicket = experiment.toggleTool(
      experiment.setDomains(experiment.emptyDraft(), ["network"]),
      "create_ticket",
      true,
    );
    expect(experiment.setDomains(withTicket, ["network", "server"]).tools).toContain(
      "create_ticket",
    );
  });

  test("the SLA, spare and surcharge settings are kept only while they differ from the defaults, and go into the request", () => {
    const d0 = experiment.setDomains(experiment.emptyDraft(), ["facility"]);
    expect(d0.leadTimes).toBeUndefined();
    const d1 = experiment.setLeadTimes(d0, { vendorSla: "4h" });
    expect(d1.leadTimes).toEqual({ vendorSla: "4h" });
    expect(experiment.leadChanged(d1, "vendorSla")).toBe(true);
    expect(experiment.leadChanged(d1, "spares")).toBe(false);
    expect(experiment.setLeadTimes(d1, { vendorSla: "nbd" }).leadTimes).toBeUndefined();
    expect(experiment.setLeadTimes(d1, undefined).leadTimes).toBeUndefined();
    const full = {
      ...d1,
      worldId: "w",
      scenarioId: "s",
      harnessId: "h",
      agentId: "a",
    };
    const request = experiment.toRequest(full, "이름");
    expect(request.recipe.domains).toEqual(["facility"]);
    expect(request.recipe.leadTimes).toEqual({ vendorSla: "4h" });
    const plain = experiment.toRequest(
      { ...experiment.emptyDraft(), worldId: "w", scenarioId: "s", harnessId: "h", agentId: "a" },
      "이름",
    );
    expect(plain.recipe).not.toHaveProperty("domains");
    expect(plain.recipe).not.toHaveProperty("leadTimes");
  });

  test("the six domains are offered with their words", () => {
    expect(DOMAIN_IDS).toHaveLength(6);
  });

  test("a template card says where the cause is and which domains to play it with", () => {
    expect(domainsLine(memory)).toBe("원인은 서버 도메인 · 내 도메인 서비스/OS·가상화 권장");
    expect(domainsLine({})).toBeUndefined();
  });
});
