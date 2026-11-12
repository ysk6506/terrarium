/**
 * Emulation gaps (ADR-0184): a hint only when the proving ground lacks something the real tool has. When the real tool
 * would also refuse, the fake says what the real tool says and nothing else.
 */

import { diagnosisRecords } from "@terrarium/core/analysis";
import { Catalog } from "@terrarium/core/catalog";
import { createFacades } from "@terrarium/core/facades";
import { Physics } from "@terrarium/core/physics";
import { SCENARIO_TEMPLATES } from "@terrarium/core/scenario";
import { Session } from "@terrarium/core/session";
import { DEFAULT_TOOLSET, TOOL_NAMES, Toolbox, type ToolContext } from "@terrarium/core/tools";
import {
  BlueprintIndex,
  type RunEvent,
  realCommandExamples,
  realCommandNames,
  realToolExample,
  realTools,
  tallyGaps,
  World,
} from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { experimentOf, SCRIPTS } from "../../packages/core/src/analysis/test-support/runs";
import { sampleBlueprint } from "../../packages/core/src/world/test-support/sample";
import { lab } from "./test-support/deep-os-lab";

describe("every hint points at something that works [REQ-098]", () => {
  test("each tool's example and each real-command example runs with exit 0", () => {
    const { run } = lab();
    for (const t of realTools()) {
      const ex = realToolExample(t);
      // a tool with no example that fits every world (`ping` needs a host that exists) gives none
      if (ex !== undefined) expect(run("srv-a2", ex).exitCode, ex).toBe(0);
    }
    for (const ex of realCommandExamples()) expect(run("srv-a2", ex).exitCode, ex).toBe(0);
  });

  test("an example is never made of a name only one world has: it works in a world of another shape", () => {
    for (const t of realTools()) {
      const ex = realToolExample(t);
      if (ex !== undefined) expect(elsewhere(ex).exitCode, `${t}: ${ex}`).toBe(0);
    }
    expect(realToolExample("ping")).toBeUndefined();
    // no example for ping, so its gap is two lines
    const ping = lab().run("srv-a2", "ping -Q 1 localhost");
    expect(terrariumLines(ping.stderr)).toHaveLength(2);
  });

  test("a real command the fake lacks is a gap with its name as the key", () => {
    const { run } = lab();
    for (const name of realCommandNames()) {
      const r = run("srv-a2", name) as { exitCode: number; gaps: unknown[] };
      expect(r.exitCode, name).toBe(127);
      expect(r.gaps, name).toEqual([{ tool: name, feature: "command" }]);
    }
  });
});

/** A command on a host of a world with another shape than the lab (the sample blueprint): what an example must also survive. */
function elsewhere(cmd: string): { exitCode: number; output: string } {
  const world = World.fromBlueprint(sampleBlueprint(), new Catalog());
  const physics = new Physics(world);
  physics.settle();
  physics.run(300);
  const r = new Toolbox(TOOL_NAMES).call(
    "run_command",
    { host: "srv-a1", cmd },
    { world, facades: createFacades(world) },
  );
  return r.data as { exitCode: number; output: string };
}

/** [command, gap key] for input the real tool accepts and the fake does not. */
const GAPS: ReadonlyArray<readonly [string, string, string]> = [
  ['awk \'BEGIN{print gensub(/a/, "b", "g", "aaa")}\'', "awk", "function:gensub"],
  ["sed -n 's/a/Q/w' /etc/hosts", "sed", "s-flag:w"],
  ["sed 'n' /etc/hosts", "sed", "command:n"],
  ["xargs -P 2 echo", "xargs", "flag:-P"],
  ["ps -Z", "ps", "flag:-Z"],
  ["head --lines=1 /etc/hosts", "head", "flag:--lines"],
  ["find /etc -print0", "find", "test:-print0"],
  ["ln /etc/hosts /tmp/hard", "ln", "hard-link"],
  ["systemctl list-timers", "systemctl", "verb:list-timers"],
  ["ip neigh", "ip", "object:neighbor"],
  ["vim /etc/hosts", "vim", "command"],
  ["export FOO=1", "export", "command"],
  ["echo $HOME", "bash", "variable-or-substitution"],
  ["if true; then echo a; fi", "bash", "keyword:if"],
];

/** Input the real tool refuses too: its own words, no hint, nothing recorded. */
const GENUINE: readonly string[] = [
  "ls --no-such-option",
  "head --bogus /etc/hosts",
  "head --follow /etc/hosts",
  "head -f /etc/hosts",
  "uname -Z",
  "find /etc -maxdepth x",
  "find /etc -mtime abc",
  "systemctl foo",
  "ip foo",
  "uptime -x",
  "nosuchcmd-xyz",
  "sed 'k' /etc/hosts",
  "cp /etc/hosts",
  "chronyc foo",
];

const terrariumLines = (stderr: string): string[] =>
  stderr.split("\n").filter((l) => l.startsWith("terrarium: "));

describe("a gap says whose limit it is, what works and one command that works [REQ-098]", () => {
  test.each(GAPS)("%s", (cmd, tool, feature) => {
    const { run } = lab();
    const r = run("srv-a2", cmd) as ReturnType<typeof run> & {
      gaps: { tool: string; feature: string }[];
    };
    expect(r.exitCode).not.toBe(0);
    // the real tool runs this input, so the answer is `terrarium:` lines only: no error line in the tool's style
    const lines = r.stderr.split("\n");
    for (const l of lines) expect(l).toMatch(/^terrarium: /);
    expect(lines[0]).toMatch(/지원하지 않아요|갖추지 못했어요/);
    expect(r.gaps.some((g) => g.tool === tool)).toBe(true);
    // a stable key: no spaces, nothing the agent typed beyond the fixed names
    for (const g of r.gaps) expect(g.feature).toMatch(/^[^\s]+$/);
    expect(r.gaps.map((g) => `${g.tool}:${g.feature}`)).toContain(`${tool}:${feature}`);
    // the alternative it offers works here and in a world of another shape
    const examples = lines
      .filter((l) => l.startsWith("terrarium: 대신 이 명령은 돼요: "))
      .map((l) => l.replace("terrarium: 대신 이 명령은 돼요: ", ""));
    expect(examples.length).toBeGreaterThan(0);
    for (const example of examples) {
      expect(run("srv-a2", example).exitCode, example).toBe(0);
      expect(elsewhere(example).exitCode, example).toBe(0);
    }
  });

  test("every item of the list of what works is something the real tool has and this one does", () => {
    const { run } = lab();
    for (const [cmd, tool, feature] of GAPS) {
      if (!feature.startsWith("flag:")) continue;
      const list = (run("srv-a2", cmd).stderr.split("\n")[1] ?? "")
        .replace(`terrarium: ${tool}에서 되는 것: `, "")
        .split(/[ ,]+/)
        .map((t) => t.replace(/^(-\w|--[\w-]+).*$/, "$1"))
        .filter((t) => /^--?\w/.test(t));
      expect(list.length, cmd).toBeGreaterThan(0);
      for (const flag of list) {
        const r = run("srv-a2", `${tool} ${flag} 1 /etc/hosts`) as ReturnType<typeof run> & {
          gaps: { feature: string }[];
        };
        expect(r.stderr, `${tool} ${flag}`).not.toMatch(
          /invalid option|unrecognized|garbage option/,
        );
        expect(
          r.gaps.map((g) => g.feature),
          `${tool} ${flag}`,
        ).not.toContain(`flag:${flag}`);
      }
    }
    // head has no --follow or --retry, so they are not listed (tail has them)
    const head = run("srv-a2", "head --lines=1 /etc/hosts").stderr;
    expect(head).not.toMatch(/--follow|--retry/);
    expect(run("srv-a2", "tail --lines=1 /etc/hosts").stderr).toContain("--follow");
  });

  test("part of the answer that is right is given with exit 0 and the lines say what is missing; the gap is still recorded", () => {
    const { run } = lab();
    for (const [cmd, tool, feature] of [
      ["tail -f -n 2 /etc/passwd", "tail", "flag:-f"],
      ["journalctl -f", "journalctl", "flag:--follow"],
    ] as const) {
      const r = run("srv-a2", cmd) as ReturnType<typeof run> & { gaps: unknown[] };
      expect(r.exitCode, cmd).toBe(0);
      expect(r.stdout, cmd).not.toBe("");
      expect(r.stderr.split("\n")[0], cmd).toMatch(/^terrarium: /);
      expect(r.gaps, cmd).toEqual([{ tool, feature }]);
    }
  });

  test("the same input gives the same stderr, byte for byte", () => {
    for (const [cmd] of GAPS) {
      expect(lab().run("srv-a2", cmd).stderr, cmd).toBe(lab().run("srv-a2", cmd).stderr);
    }
  });
});

describe("a genuine error is the real tool's own words, with no hint [REQ-098]", () => {
  test.each(GENUINE)("%s", (cmd) => {
    const r = lab().run("srv-a2", cmd) as ReturnType<ReturnType<typeof lab>["run"]> & {
      gaps: unknown[];
    };
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).not.toContain("terrarium:");
    expect(r.gaps).toEqual([]);
  });
});

describe("a switch CLI line the real OS reads is a gap, one it rejects is not [REQ-098]", () => {
  function boot() {
    const world = World.fromBlueprint(sampleBlueprint(), new Catalog());
    const physics = new Physics(world);
    physics.settle();
    physics.run(300);
    const tools = new Toolbox(TOOL_NAMES);
    const ctx: ToolContext = { world, facades: createFacades(world) };
    return (commands: string[], device = "tor-a") =>
      tools.call("network_cli", { device, commands }, ctx).data as {
        steps: { output: string; ok: boolean }[];
        gaps?: { tool: string; feature: string }[];
      };
  }

  test("show ip ospf neighbor: only the terrarium lines, and the example works", () => {
    const cli = boot();
    const r = cli(["enable", "show ip ospf neighbor"]);
    const out = r.steps[1]?.output as string;
    expect(r.steps[1]?.ok).toBe(false);
    // the real OS reads this line, so there is no `Invalid input` line of its own: the terrarium lines are all of it
    const lines = terrariumLines(out);
    expect(out.split("\n")).toEqual(lines);
    expect(lines).toHaveLength(3);
    expect(r.gaps).toEqual([{ tool: expect.any(String), feature: "show-ip-ospf-neighbor" }]);
    const example = (lines[2] as string).replace("terrarium: 대신 이 명령은 돼요: ", "");
    expect(cli(["enable", example]).steps[1]?.ok, example).toBe(true);
    expect(out).toBe(cli(["enable", "show ip ospf neighbor"]).steps[1]?.output);
  });

  test("a made-up command is only the OS's own error", () => {
    const r = boot()(["enable", "show nonsense"]);
    expect(r.steps[1]?.ok).toBe(false);
    expect(terrariumLines(r.steps[1]?.output as string)).toEqual([]);
    expect(r.gaps).toBeUndefined();
  });
});

describe("a gap is its own event in the run and a count in the export [REQ-098]", () => {
  test("the run stream carries it beside the call, with keys and no command text", () => {
    const blueprint = sampleBlueprint();
    const scenario = SCENARIO_TEMPLATES.find((t) => t.id === "cooling-failure")?.build(
      new BlueprintIndex(blueprint),
      "sample",
    );
    if (!scenario) throw new Error("template");
    const session = Session.create({
      blueprint,
      scenario,
      tools: [...DEFAULT_TOOLSET, "run_command"],
      seed: 7,
    });
    session.start();
    session.call("run_command", { host: "srv-a1", cmd: "ps -Z" });
    session.call("run_command", { host: "srv-a1", cmd: "uname -Z" });
    const result = session.finish();
    const events = result.events as readonly RunEvent[];
    const gaps = events.filter((e) => e.kind === "gap");
    expect(gaps).toHaveLength(1);
    const gap = gaps[0] as Extract<RunEvent, { kind: "gap" }>;
    expect(gap).toMatchObject({ tool: "ps", feature: "flag:-Z" });
    expect(events[gap.call]).toMatchObject({ kind: "tool", tool: "run_command" });
    expect(gap.seq).toBe(gap.call + 1);
    expect(Object.keys(gap).sort()).toEqual(["call", "feature", "kind", "seq", "t", "tool"]);
    expect(result.toolCalls.filter((c) => c.gaps)).toHaveLength(1);
  });

  test("the diagnosis export counts gaps by key and leaves the field out when there were none", () => {
    const { experiment, runs } = experimentOf({ id: "e1", runs: [SCRIPTS.good, SCRIPTS.good] });
    const withGaps = runs.map((run, i) =>
      i === 0 && run.result
        ? {
            ...run,
            result: {
              ...run.result,
              toolCalls: [
                ...run.result.toolCalls,
                {
                  t: 1,
                  tool: "run_command",
                  args: {},
                  ok: true,
                  gaps: [{ tool: "awk", feature: "getline" }],
                },
                {
                  t: 2,
                  tool: "run_command",
                  args: {},
                  ok: true,
                  gaps: [{ tool: "awk", feature: "getline" }],
                },
              ],
            },
          }
        : run,
    );
    const [first, second] = diagnosisRecords(experiment, withGaps);
    expect(first?.gaps).toEqual([{ tool: "awk", feature: "getline", n: 2 }]);
    expect(second && "gaps" in second).toBe(false);
    expect(
      tallyGaps([
        { tool: "b", feature: "x" },
        { tool: "a", feature: "x" },
      ]),
    ).toEqual([
      { tool: "a", feature: "x", n: 1 },
      { tool: "b", feature: "x", n: 1 },
    ]);
  });
});
