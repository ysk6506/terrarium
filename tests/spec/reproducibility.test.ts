/**
 * What makes two runs comparable (REQ-001, REQ-039, REQ-040, REQ-070): the same seed and the same calls give the
 * same result down to the score items; runs that take turns in one process do not disturb each other; a warm start
 * changes nothing but the time it takes; and swapping the tools an agent is given leaves the exam itself (world,
 * scenario, scoring) untouched, so it is the agent's tools that differ and nothing else.
 */
import { NETWORK_TEMPLATES } from "@terrarium/core/scenario";
import { Session, type SessionConfig, WarmStartCache } from "@terrarium/core/session";
import { DEFAULT_TOOLSET, TOOL_NAMES } from "@terrarium/core/tools";
import { type Blueprint, BlueprintIndex } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { networkLab } from "../../packages/core/src/world/test-support/net-lab";

const blueprint: Blueprint = networkLab();
const template = NETWORK_TEMPLATES.find((t) => t.id === "port-shut-by-mistake");

function config(extra: Partial<SessionConfig> = {}): SessionConfig {
  if (!template) throw new Error("no template");
  return {
    blueprint,
    scenario: template.build(new BlueprintIndex(blueprint), "lab"),
    tools: TOOL_NAMES,
    seed: 7,
    ...extra,
  };
}

const answer = (() => {
  const e = config().scenario.expectations.find((x) => x.kind === "diagnosis");
  if (e?.kind !== "diagnosis") throw new Error("no diagnosis");
  return { rootCause: e.rootCause[0], faultType: e.faultType[0] };
})();

/** The same sequence of agent moves every time. */
const MOVES: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
  ["list_alarms", {}],
  ["network_cli", { device: "tor-a", commands: ["show interfaces status"], configure: false }],
  ["wait", { seconds: 120 }],
  [
    "network_cli",
    { device: "tor-a", commands: ["interface Ethernet1/1", "no shutdown"], configure: true },
  ],
  ["submit_diagnosis", { ...answer, summary: "포트가 꺼져 있었어요" }],
];

function play(session: Session, moves = MOVES) {
  session.start();
  for (const [tool, args] of moves) session.call(tool, args);
  return session.finish();
}

/** Everything about a run that is not a timestamp of the real clock. */
const essence = (r: ReturnType<typeof play>) =>
  JSON.stringify({
    score: r.score,
    digests: r.digests,
    toolCalls: r.toolCalls,
    timeline: r.timeline,
    simTime: r.simTime,
    diagnosis: r.diagnosis,
    endReason: r.endReason,
  });

describe("runs that should match do match [REQ-001] [REQ-070]", () => {
  test("the same seed and the same calls give the same result, item by item", () => {
    const a = play(Session.create(config()));
    const b = play(Session.create(config()));
    expect(a.score.total).toBeGreaterThanOrEqual(90);
    expect(essence(a)).toBe(essence(b));
  });

  test("two runs taking turns in one process do not disturb each other", () => {
    const solo = play(Session.create(config()));
    const first = Session.create(config());
    const second = Session.create(config({ seed: 8 }));
    first.start();
    second.start();
    for (const [tool, args] of MOVES) {
      first.call(tool, args);
      second.call(tool, args);
    }
    expect(essence(first.finish())).toBe(essence(solo));
    expect(second.finish().score.total).toBe(solo.score.total);
  });

  test("a warm start changes how long a run takes, not what it finds", () => {
    const warm = new WarmStartCache();
    const cold = play(Session.create(config()));
    const filled = play(Session.create(config({ warm })));
    const reused = play(Session.create(config({ warm })));
    expect(essence(filled)).toBe(essence(cold));
    expect(essence(reused)).toBe(essence(cold));
  });
});

describe("a different set of tools changes the agent, not the exam [REQ-040] [REQ-039]", () => {
  test("world, scenario and scoring are the same however many tools are given", () => {
    const all = play(Session.create(config()));
    const fewer = Session.create(config({ tools: DEFAULT_TOOLSET }));
    fewer.start();
    fewer.call("list_alarms", {});
    const small = fewer.finish();
    expect(small.digests).toEqual(all.digests);
    expect(small.score.version).toBe(all.score.version);
  });

  test("a tool the experiment did not select is refused, so a run cannot quietly use more than it was given", () => {
    const session = Session.create(config({ tools: ["list_alarms"] }));
    session.start();
    const result = session.call("network_cli", { device: "tor-a", commands: ["show version"] });
    expect(result.ok).toBe(false);
    expect(session.finish().toolCalls.at(-1)?.ok).toBe(false);
  });
});
