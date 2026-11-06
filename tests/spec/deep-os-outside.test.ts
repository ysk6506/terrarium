/**
 * "흉내 밖 명령" and "흔한 명령만으로 원인에 닿는가" (REQ-098, ADR-0117 decisions 6 and 7): a run counts what the fake
 * shell could not do and says so in its result; the calibration asks whether the common commands show the cause of each
 * operating-system fault.
 */
import { OS_TEMPLATES, type ScenarioDoc } from "@terrarium/core/scenario";
import {
  calibrate,
  FIRST_LOOK,
  NO_COMMON_COMMANDS,
  Session,
  SIGNS,
  shellReach,
} from "@terrarium/core/session";
import { DEFAULT_WORLDGEN, generateWorld } from "@terrarium/core/sources/worldgen";
import { TOOL_NAMES } from "@terrarium/core/tools";
import {
  type Blueprint,
  BlueprintIndex,
  type FaultType,
  OS_FAULT_TYPES,
} from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { lab } from "./test-support/deep-os-lab";

const hall = (): Blueprint =>
  generateWorld({ ...DEFAULT_WORLDGEN, rows: 2, racksPerRow: 4, site: "hwaseong", seed: 3 })
    .blueprint;

function sheet(id: string): { scenario: ScenarioDoc; blueprint: Blueprint } {
  const blueprint = hall();
  const t = OS_TEMPLATES.find((x) => x.id === id);
  if (!t) throw new Error(`no template ${id}`);
  return { scenario: t.build(new BlueprintIndex(blueprint), "lab"), blueprint };
}

function hostOf(scenario: ScenarioDoc): string {
  const d = scenario.expectations.find((e) => e.kind === "diagnosis") as unknown as {
    rootCause: string[];
  };
  return d.rootCause[0] as string;
}

describe("a run says how often the fake shell was out of its depth [REQ-098]", () => {
  test("unknown commands and unsupported features are counted and listed; what the shell did is not", () => {
    const { scenario, blueprint } = sheet("os-disk-full");
    const run = Session.create({ blueprint, scenario, tools: TOOL_NAMES, seed: 1 });
    run.start();
    const host = hostOf(scenario);
    for (const cmd of [
      "df -h",
      "kubectl get pods",
      "kubectl get nodes",
      "tail -f /var/log/messages",
      "echo $HOME",
      "journalctl -n 3",
    ])
      run.call("run_command", { host, cmd });
    const { shellOutside } = run.finish();
    expect(shellOutside).toMatchObject({ commands: 6, count: 4 });
    expect(shellOutside?.items[0]).toEqual({ what: "kubectl", n: 2 });
    expect(shellOutside?.items.map((i) => i.what)).toEqual(
      expect.arrayContaining(["tail -f", "셸 문법 $"]),
    );
  });

  test("a run that used the shell for nothing the fake lacks says 0; a run without run_command says nothing", () => {
    const { scenario, blueprint } = sheet("os-disk-full");
    const clean = Session.create({ blueprint, scenario, tools: TOOL_NAMES, seed: 1 });
    clean.start();
    clean.call("run_command", { host: hostOf(scenario), cmd: "df -h | tail -1" });
    expect(clean.finish().shellOutside).toEqual({ commands: 1, count: 0, items: [] });
    const none = Session.create({ blueprint, scenario, tools: TOOL_NAMES, seed: 1 });
    none.start();
    none.call("wait", { seconds: 10 });
    expect(none.finish().shellOutside).toBeUndefined();
  });

  test("the count is not part of the score", () => {
    const { scenario, blueprint } = sheet("os-disk-full");
    const totals = [0, 5].map((n) => {
      const run = Session.create({ blueprint, scenario, tools: TOOL_NAMES, seed: 1 });
      run.start();
      for (let i = 0; i < n; i++) run.call("run_command", { host: hostOf(scenario), cmd: "vim" });
      return run.finish().score.total;
    });
    expect(totals[1]).toBe(totals[0]);
  });
});

describe("the common commands show the cause of each fault [REQ-098]", () => {
  test("every fault has a sign to look for", () => {
    expect(Object.keys(SIGNS).sort()).toEqual([...OS_FAULT_TYPES].sort());
  });

  for (const fault of OS_FAULT_TYPES) {
    test(`${fault}: one of the first-look commands prints its sign`, () => {
      const { run, inject, physics } = lab();
      inject(fault as FaultType, "srv-a2", fault === "kernel_panic" ? { downSeconds: 30 } : {});
      physics.run(fault === "kernel_panic" ? 200 : 600);
      const hit = FIRST_LOOK.find((cmd) => SIGNS[fault]?.test(run("srv-a2", cmd).output));
      expect(hit, `no first-look command shows ${fault}`).toBeDefined();
    });
  }

  test("a scripted agent with only the common commands reaches the cause of every operating-system sheet", () => {
    for (const t of OS_TEMPLATES) {
      const { scenario, blueprint } = sheet(t.id);
      const reach = shellReach({ blueprint, scenario });
      expect(reach, t.id).toMatchObject({ reached: true });
      expect(calibrate({ blueprint, scenario }).warnings).not.toContain(NO_COMMON_COMMANDS);
    }
  });

  test("a scenario that is not about the inside of a host has nothing to look for", () => {
    const blueprint = hall();
    const t = OS_TEMPLATES[0];
    const scenario = {
      ...(t?.build(new BlueprintIndex(blueprint), "lab") as ScenarioDoc),
      expectations: [],
    };
    expect(shellReach({ blueprint, scenario })).toBeUndefined();
  });
});
