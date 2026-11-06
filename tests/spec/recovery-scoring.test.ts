/**
 * Recovery-first scoring (REQ-088, ADR-0091 item 3 and 4, ADR-0104): a scenario with services is scored by how soon the
 * services were well again, how soon the agent acted, whether it made things worse and what it reported. Nine scripted
 * agents that need no model play the five OS sheets in two worlds, and the order they come out in is the design:
 * fixing first beats finding the cause first, and finding the cause first beats a restart that fixes nothing.
 */
import { analyzeRecovery, serviceHarms } from "@terrarium/core/oracle";
import {
  ALL_SCENARIO_TEMPLATES,
  OS_TEMPLATES,
  SCENARIO_TEMPLATES,
  type ScenarioDoc,
} from "@terrarium/core/scenario";
import { calibrate, NO_COMMON_PATH, recoveryPath, Session } from "@terrarium/core/session";
import { DEFAULT_WORLDGEN, generateWorld } from "@terrarium/core/sources/worldgen";
import { DEFAULT_TOOLSET } from "@terrarium/core/tools";
import { storyLine } from "@terrarium/core/topology";
import { type Blueprint, BlueprintIndex } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { networkLab } from "../../packages/core/src/world/test-support/net-lab";
import { campusBlueprint } from "../../packages/core/src/world/test-support/sample-campus";
import { aboutOf, FAKE_AGENTS, runFake } from "./recovery-agents";

const hall = (): Blueprint =>
  generateWorld({ ...DEFAULT_WORLDGEN, rows: 2, racksPerRow: 4, site: "hwaseong", seed: 3 })
    .blueprint;

const WORLDS: ReadonlyArray<readonly [string, () => Blueprint]> = [
  ["a hall", hall],
  ["the campus sample", campusBlueprint],
];

const build = (id: string, blueprint: Blueprint): ScenarioDoc => {
  const t = OS_TEMPLATES.find((x) => x.id === id);
  if (!t) throw new Error(id);
  return t.build(new BlueprintIndex(blueprint), "lab");
};

const totals = (blueprint: Blueprint, scenario: ScenarioDoc) =>
  Object.fromEntries(
    FAKE_AGENTS.map((a) => [a.id, runFake(a, blueprint, scenario).score.total ?? -1]),
  ) as Record<string, number>;

describe("the nine scripted agents come out in the order the design wants [REQ-088]", () => {
  for (const [world, make] of WORLDS) {
    for (const t of OS_TEMPLATES) {
      test(`${t.id} in ${world}`, () => {
        const blueprint = make();
        const s = totals(blueprint, build(t.id, blueprint));
        // knowing nothing earns nothing, and the answer alone is only the report's 30 points
        expect(s.idle).toBe(0);
        expect(s.guess).toBe(0);
        expect(s.knows).toBe(30);
        expect(s["wait-after-diagnosis"]).toBe(30);
        // fix first and look for the cause after is full marks
        expect(s["recover-first"]).toBe(100);
        expect(s["fix-and-report"]).toBe(100);
        // finding the cause first and fixing ten minutes later passes, but well below
        expect(s["cause-first"]).toBeLessThan(s["recover-first"] as number);
        expect(s["cause-first"]).toBeGreaterThanOrEqual(60);
        // a restart that fixes nothing is the answer alone, plus at most a pause of a leak
        expect(s["restart-only"]).toBeLessThan(s["cause-first"] as number);
        expect(s["restart-only"]).toBeLessThanOrEqual(40);
        // a reboot takes points back
        expect(s.reboot).toBeLessThan(s["recover-first"] as number);
      });
    }
  }

  test("a reboot of a host whose file system went read-only recovers, minus what the reboot costs", () => {
    const blueprint = hall();
    const s = totals(blueprint, build("os-fs-readonly", blueprint));
    expect(s.reboot).toBe(85);
  });
});

describe("a run says which scoring it had and what the trouble cost [REQ-088]", () => {
  test("a scenario with services is scored recovery first and a plain one as written", () => {
    const blueprint = hall();
    const os = runFake(
      FAKE_AGENTS[7] as (typeof FAKE_AGENTS)[number],
      blueprint,
      build("os-disk-full", blueprint),
    );
    expect(os.score.scoring).toBe("recovery");
    expect(os.score.summary).toMatch(/^복구 우선 채점/);
    expect(os.score.items.map((i) => i.id)).toEqual([
      "recovery_time",
      "recovery_order",
      "no_worsening",
      "diagnosis",
      "no-reboot",
    ]);
    const plain = SCENARIO_TEMPLATES.find((t) => t.id === "cooling-failure");
    const campus = campusBlueprint();
    const doc = plain?.build(new BlueprintIndex(campus), "campus") as ScenarioDoc;
    const session = Session.create({
      blueprint: campus,
      scenario: doc,
      tools: DEFAULT_TOOLSET,
      seed: 1,
    });
    session.start();
    const classic = session.finish().score;
    expect(classic.scoring).toBe("classic");
    expect(classic.recovery).toBeUndefined();
  });

  test("the cost is the time stopped times the harm an hour, and a leak costs less when fixed sooner", () => {
    const blueprint = hall();
    const scenario = build("os-process-crashloop", blueprint);
    const early = runFake(
      FAKE_AGENTS[7] as (typeof FAKE_AGENTS)[number],
      blueprint,
      scenario,
    ).score;
    const late = runFake(FAKE_AGENTS[8] as (typeof FAKE_AGENTS)[number], blueprint, scenario).score;
    const e = early.recovery;
    const l = late.recovery;
    expect(e?.recovered && l?.recovered).toBe(true);
    expect(e?.costKrw).toBeGreaterThan(0);
    expect(l?.costKrw ?? 0).toBeGreaterThan(e?.costKrw ?? 0);
    // the portal is 2,000,000 won an hour: the cost is the seconds it was stopped at that rate
    const stopped = (l?.seconds ?? 0) / 3600;
    expect(l?.costKrw ?? 0).toBeCloseTo(stopped * 2_000_000, -3);
  });

  test("scoring a finished run again from its events and its world gives the same report", () => {
    const blueprint = hall();
    for (const agent of FAKE_AGENTS) {
      const result = runFake(agent, blueprint, build("os-memory-leak", blueprint));
      const again = analyzeRecovery(
        result.events ?? [],
        serviceHarms(new BlueprintIndex(blueprint)),
      );
      expect(again, agent.id).toEqual(result.score.recovery);
    }
  });

  test("the first line of the result tells how many services stopped, before the agent acted and at the end", () => {
    const blueprint = hall();
    const scenario = build("os-process-crashloop", blueprint);
    const result = runFake(FAKE_AGENTS[7] as (typeof FAKE_AGENTS)[number], blueprint, scenario);
    const story = storyLine(result.events ?? [], {
      origin: result.simTime.scenarioStart,
      servers: { before: 1, after: 0, at: result.simTime.agentStart },
    });
    const texts = story.parts.map((p) => p.text);
    expect(texts).toContain("영향 범위 서버 1 → 0 · 서비스 1개 멈춤 → 0");
    // without the servers part the services still show
    const alone = storyLine(result.events ?? [], { origin: result.simTime.scenarioStart });
    expect(alone.parts.map((p) => p.text)).toContain("서비스 1개 멈춤 → 0");
    // a slow service is a slow one, not a stopped one
    const slow = runFake(
      FAKE_AGENTS[7] as (typeof FAKE_AGENTS)[number],
      blueprint,
      build("os-disk-full", blueprint),
    );
    const words = storyLine(slow.events ?? []).parts.map((p) => p.text);
    expect(words).toContain("서비스 1개 느려짐 → 0");
  });

  test("a run in which no service was in trouble has no services in its first line", () => {
    const campus = campusBlueprint();
    const doc = SCENARIO_TEMPLATES.find((t) => t.id === "cooling-failure")?.build(
      new BlueprintIndex(campus),
      "campus",
    ) as ScenarioDoc;
    const session = Session.create({
      blueprint: campus,
      scenario: doc,
      tools: DEFAULT_TOOLSET,
      seed: 1,
    });
    session.start();
    const events = session.finish().events ?? [];
    expect(
      storyLine(events)
        .parts.map((p) => p.text)
        .join(" "),
    ).not.toContain("서비스");
  });
});

describe("the default tools can solve a fault of the operating system [REQ-088]", () => {
  test("the default selection has the shell and still leaves the raw protocol requests out", () => {
    expect(DEFAULT_TOOLSET).toContain("run_command");
    expect(DEFAULT_TOOLSET).toContain("failover_service");
    expect(DEFAULT_TOOLSET).not.toContain("redfish_request");
    expect(DEFAULT_TOOLSET).not.toContain("snmp_request");
  });

  test("a full disk is cleared with the default selection alone", () => {
    const blueprint = hall();
    const scenario = build("os-disk-full", blueprint);
    const { host, service } = aboutOf(scenario);
    const session = Session.create({ blueprint, scenario, tools: DEFAULT_TOOLSET, seed: 1 });
    session.start();
    expect(session.call("run_command", { host, cmd: "rm /var/log/journal/old.log" }).ok).toBe(true);
    session.call("wait", { seconds: 30 });
    expect(session.call("service_status", { service }).data).toMatchObject({ status: "healthy" });
  });
});

describe("every sheet about services has a way to recover that needs no repair [REQ-088]", () => {
  for (const [world, make] of WORLDS) {
    for (const t of OS_TEMPLATES) {
      test(`${t.id} in ${world}: moving the service brings it back`, () => {
        const blueprint = make();
        const path = recoveryPath({ blueprint, scenario: build(t.id, blueprint) });
        expect(path).toMatchObject({ applicable: true, ok: true, how: "failover_service" });
      });
    }
  }

  test("a scenario that is not about services has nothing to move", () => {
    const campus = campusBlueprint();
    const doc = SCENARIO_TEMPLATES.find((t) => t.id === "cooling-failure")?.build(
      new BlueprintIndex(campus),
      "campus",
    ) as ScenarioDoc;
    expect(recoveryPath({ blueprint: campus, scenario: doc })).toMatchObject({ applicable: false });
  });

  test("a world whose services have no standby fails the check, and the calibration says so", () => {
    const blueprint = hall();
    const bare: Blueprint = {
      ...blueprint,
      links: blueprint.links.filter(
        (l) => !(l.kind === "service_on" && l.props.role === "standby"),
      ),
    };
    const scenario = build("os-disk-full", bare);
    expect(recoveryPath({ blueprint: bare, scenario })).toMatchObject({
      applicable: true,
      ok: false,
    });
    const c = calibrate({ blueprint: bare, scenario });
    expect(c.warnings.join(" ")).toContain("서비스를 옮겨서 복구하는 길이 없어요");
  });
});

describe("the calibration says whether the common tools reach the cause [REQ-088]", () => {
  test("the OS sheets are reached from the alarms in a few calls", () => {
    for (const [, make] of WORLDS) {
      const blueprint = make();
      for (const t of OS_TEMPLATES) {
        const c = calibrate({ blueprint, scenario: build(t.id, blueprint) });
        expect(c.commonReach?.reached, t.id).toBe(true);
        expect(c.commonReach?.calls).toBeLessThanOrEqual(4);
        expect(c.warnings.join(" ")).not.toContain(NO_COMMON_PATH);
      }
    }
  });

  test("a silent fault no alarm points to is flagged, and a task has no cause to reach", () => {
    const campus = campusBlueprint();
    const index = new BlueprintIndex(campus);
    const build1 = (id: string) =>
      ALL_SCENARIO_TEMPLATES.find((t) => t.id === id)?.build(index, "campus") as ScenarioDoc;
    const failure = calibrate({ blueprint: campus, scenario: build1("firmware-failure") });
    expect(failure.commonReach?.reached).toBe(false);
    expect(failure.warnings).toContain(NO_COMMON_PATH);
    const task = calibrate({ blueprint: campus, scenario: build1("firmware-one") });
    expect(task.commonReach).toBeUndefined();
  });

  test("a cooling unit that stops is reached from its alarm in every test world", () => {
    for (const make of [campusBlueprint, networkLab]) {
      const blueprint = make();
      const index = new BlueprintIndex(blueprint);
      const t = SCENARIO_TEMPLATES.find((x) => x.id === "cooling-failure");
      const scenario = t?.build(index, "lab") as ScenarioDoc;
      expect(calibrate({ blueprint, scenario }).commonReach).toMatchObject({ reached: true });
    }
  });
});
