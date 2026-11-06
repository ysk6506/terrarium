/**
 * Escalation (REQ-081, ADR-0087 item 4): an agent that calls `ask_human` is answered by the setup, ends the run, or
 * waits for a person; a person can answer, act in the world, hand over tools or end the run; escalation is counted
 * apart from the score; and what a person did is never the agent's act.
 */
import { ALL_SCENARIO_TEMPLATES } from "@terrarium/core/scenario";
import {
  DEFAULT_AUTO_REPLY,
  type EscalationPolicy,
  Session,
  type SessionConfig,
} from "@terrarium/core/session";
import { DEFAULT_TOOLSET } from "@terrarium/core/tools";
import { BlueprintIndex } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { sampleBlueprint } from "../../packages/core/src/world/test-support/sample";

const scenario = () => {
  const t = ALL_SCENARIO_TEMPLATES.find((x) => x.id === "cooling-failure");
  if (!t) throw new Error("template");
  return t.build(new BlueprintIndex(sampleBlueprint()), "sample");
};

function open(escalation?: EscalationPolicy, extra: Partial<SessionConfig> = {}): Session {
  const session = Session.create({
    blueprint: sampleBlueprint(),
    scenario: scenario(),
    tools: [...DEFAULT_TOOLSET, "ask_human"],
    seed: 5,
    ...(escalation ? { escalation } : {}),
    ...extra,
  });
  session.start();
  return session;
}

const ASK = { request: "냉방기가 안 켜져요. 현장에서 봐 주실 수 있나요?" };

describe("answered by the setup [REQ-081]", () => {
  test("a fixed answer comes back at once and the run goes on", () => {
    const s = open({ mode: "auto", reply: "내일 오전에 가요" });
    const r = s.call("ask_human", ASK);
    expect(r).toMatchObject({ ok: true, data: { reply: "내일 오전에 가요", from: "auto" } });
    expect(s.status).toBe("running");
    expect(s.call("list_alarms", {}).ok).toBe(true);
    const done = s.finish();
    expect(done.human).toMatchObject({ mode: "auto", count: 1, waitedSeconds: 0, acts: [] });
  });

  test("without a setting the answer says nobody can help", () => {
    const r = open().call("ask_human", ASK);
    expect(r.data).toMatchObject({ reply: DEFAULT_AUTO_REPLY, from: "auto" });
  });

  test("asking without saying what is needed is refused like any bad input", () => {
    const r = open().call("ask_human", {});
    expect(r.ok).toBe(false);
    expect(r.error).toContain("request");
  });

  test("when asking fails the run, it ends at once and the end is named", () => {
    const s = open({ mode: "fail" });
    const r = s.call("ask_human", ASK);
    expect(r).toMatchObject({ ok: false, ended: "escalated" });
    expect(s.status).toBe("ended");
    expect(s.finish().endReason).toBe("escalated");
  });

  test("a run without the tool shows no escalation block", () => {
    const s = Session.create({
      blueprint: sampleBlueprint(),
      scenario: scenario(),
      tools: DEFAULT_TOOLSET,
      seed: 5,
    });
    s.start();
    expect(s.finish().human).toBeUndefined();
  });
});

describe("waiting for a person [REQ-081]", () => {
  test("the call stops the run: simulated time stands still and no other call is taken", () => {
    const s = open({ mode: "wait" });
    s.call("list_alarms", {});
    const before = s.world.time();
    const r = s.call("ask_human", ASK);
    expect(r.waiting).toMatchObject({ request: ASK.request });
    expect(r.waiting?.recent.map((c) => c.tool)).toEqual(["list_alarms"]);
    expect(s.world.time()).toBe(before);
    expect(s.waitingForPerson).toBeDefined();
    const other = s.call("list_alarms", {});
    expect(other.ok).toBe(false);
    expect(other.error).toContain("waiting for a person");
    expect(s.world.time()).toBe(before);
  });

  test("the card shows the last five calls, newest last", () => {
    const s = open({ mode: "wait" });
    for (let i = 0; i < 7; i++) s.call(i % 2 === 0 ? "list_alarms" : "list_entities", {});
    const r = s.call("ask_human", ASK);
    expect(r.waiting?.recent).toHaveLength(5);
    expect(r.waiting?.recent.map((c) => c.tool)).toEqual([
      "list_alarms",
      "list_entities",
      "list_alarms",
      "list_entities",
      "list_alarms",
    ]);
  });

  test("answering in words gives the agent the text as the tool result", () => {
    const s = open({ mode: "wait" });
    s.call("ask_human", ASK);
    const r = s.resolveHuman({
      kind: "reply",
      text: "냉방기 팬을 교체하는 중이에요",
      waitedSeconds: 42.5,
    });
    expect(r).toMatchObject({
      ok: true,
      data: { reply: "냉방기 팬을 교체하는 중이에요", from: "human" },
    });
    expect(s.waitingForPerson).toBeUndefined();
    expect(s.call("list_alarms", {}).ok).toBe(true);
    expect(s.finish().human).toMatchObject({ mode: "wait", count: 1, waitedSeconds: 42.5 });
  });

  test("what a person does in the world comes back as a summary, and is not the agent's act", () => {
    const s = open({ mode: "wait" });
    s.call("ask_human", ASK);
    const act = s.humanAct("set_cooling_setpoint", { unitId: "crah-2", celsius: 17 });
    expect(act).toMatchObject({ ok: true, tool: "set_cooling_setpoint" });
    expect(act.summary).toContain("냉방 설정 변경");
    expect(s.world.events().some((e) => e.cause === "human")).toBe(true);
    const r = s.resolveHuman({ kind: "acted", waitedSeconds: 10 });
    expect(r.data).toMatchObject({ from: "human", changes: [act.summary] });
    const done = s.finish();
    expect(done.human?.acts).toEqual([act]);
    // scoring sees the agent's calls only: the person's setpoint change is not the agent's
    expect(done.toolCalls.flatMap((c) => c.effects ?? [])).toEqual([]);
    expect(
      done.score.items.find((i) => i.id === "spare-setpoint")?.points,
      "the person's change earned the agent nothing",
    ).toBe(0);
  });

  test("a person can only do what changes the world, and only while the run waits", () => {
    const s = open({ mode: "wait" });
    expect(() => s.humanAct("power_server", { id: "srv-a1", action: "off" })).toThrow(/no one/);
    s.call("ask_human", ASK);
    expect(() => s.humanAct("list_alarms", {})).toThrow(/does not change the world/);
  });

  test("tools handed over in the middle of the run are the agent's from then on", () => {
    const s = open({ mode: "wait" });
    expect(s.toolSpecs().map((t) => t.name)).not.toContain("get_impact");
    s.call("ask_human", ASK);
    const r = s.resolveHuman({ kind: "more_tools", tools: ["get_impact", "get_topology"] });
    expect(r.data).toMatchObject({ newTools: ["get_impact", "get_topology"] });
    expect(s.toolSpecs().map((t) => t.name)).toContain("get_impact");
    expect(s.call("get_impact", { id: "crah-1" }).ok).toBe(true);
    expect(s.finish().human?.granted).toEqual(["get_impact", "get_topology"]);
  });

  test("a person can end the run", () => {
    const s = open({ mode: "wait" });
    s.call("ask_human", ASK);
    const r = s.resolveHuman({ kind: "end", waitedSeconds: 3 });
    expect(r).toMatchObject({ ok: false, ended: "escalated" });
    expect(s.finish().endReason).toBe("escalated");
  });

  test("a run stopped while it waits records the question as unanswered", () => {
    const s = open({ mode: "wait" });
    s.call("ask_human", ASK);
    const done = s.finish("cancelled");
    expect(done.toolCalls.at(-1)).toMatchObject({ tool: "ask_human", ok: false });
    expect(done.human?.count).toBe(1);
  });

  test("nobody to answer is an error, not a hang", () => {
    const s = open({ mode: "wait" });
    expect(() => s.resolveHuman({ kind: "reply", text: "x" })).toThrow(/no one/);
  });
});

describe("the record keeps the request and the answer [REQ-081]", () => {
  test("the events say who asked what, what the person did, and how it was answered", () => {
    const s = open({ mode: "wait" });
    s.call("ask_human", ASK);
    s.humanAct("restart_cooling_unit", { unitId: "crah-1" });
    s.resolveHuman({ kind: "acted", waitedSeconds: 7 });
    const humans = s.finish().events?.filter((e) => e.kind === "human") ?? [];
    expect(humans.map((e) => (e.kind === "human" ? e.what : ""))).toEqual([
      "asked",
      "acted",
      "answered",
    ]);
    expect(humans[0]).toMatchObject({ request: ASK.request });
    expect(humans[2]).toMatchObject({ by: "human", answer: "acted", waitedSeconds: 7 });
  });

  test("an answer by the setup is recorded as the setup's", () => {
    const s = open({ mode: "auto" });
    s.call("ask_human", ASK);
    const humans = s.finish().events?.filter((e) => e.kind === "human") ?? [];
    expect(humans.at(-1)).toMatchObject({ what: "answered", by: "auto" });
  });
});

describe("real time stands still while a person is waited for [REQ-081]", () => {
  test("the world does not move while waiting, and the wait is not counted afterwards", () => {
    const s = open({ mode: "wait" }, { time: { kind: "realtime", speed: 10 } });
    expect(s.sync(60)).toBeUndefined();
    const at = s.world.time();
    s.call("ask_human", ASK);
    s.sync(600);
    expect(s.world.time()).toBe(at);
    s.resolveHuman({ kind: "reply", text: "ok", waitedSeconds: 540 });
    s.sync(660);
    // 660 s of wall clock passed, 540 of them waiting: 120 s of work at 10x since the start, 60 s of it before asking
    expect(Math.abs(s.world.time() - at - 600)).toBeLessThan(30);
  });
});
