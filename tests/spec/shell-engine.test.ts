/**
 * The real shell and awk (WebAssembly), plugged in behind a switch (ADR-0196, ADR-0200). The old shell stays the
 * default: this file only runs the new engine. What it checks is what the decision made a condition of switching on:
 * the limits count things so a line stops in the same place on every machine, nothing a limit stops ends quietly with
 * 0, and a refused write is the real shell's words and exit code.
 */
import { registerShellCommand } from "@terrarium/core/world";
import { afterAll, describe, expect, test } from "vitest";
import { engineLab, sharedEngine } from "./test-support/shell-engine-lab";

afterAll(() => sharedEngine().close());

const spin = (ms: number): void => {
  const end = performance.now() + ms;
  while (performance.now() < end);
};
let slowMs = 0;
registerShellCommand("slowecho", (c) => {
  spin(slowMs);
  return { out: `${c.args.join(" ")}\n`, code: 0 };
});

describe("the new engine runs the shell language [REQ-098]", () => {
  test("[REQ-098] variables, loops, substitutions and awk work, and an export reaches the commands the fake runs", () => {
    const { sh } = engineLab();
    expect(sh("x=3; echo $((x*2))")).toBe("6");
    expect(sh("for i in 1 2 3; do echo $i; done | wc -l")).toBe("3");
    expect(sh("echo $(echo a)b")).toBe("ab");
    expect(sh("export FOO=1; printenv FOO; FOO=2 printenv FOO; printenv FOO")).toBe("1\n2\n1");
    expect(sh("printf 'a 1\\nb 2\\n' | awk '{s+=$2} END {print s}'")).toBe("3");
  });

  test("[REQ-098] awk matches gawk where goawk differed: substr, %g of infinity, **", () => {
    const { sh } = engineLab();
    expect(sh(`awk 'BEGIN { print substr("hello", 0, 2) "|" substr("hello", -1, 4) }'`)).toBe(
      "he|hell",
    );
    expect(sh(`awk 'BEGIN { printf "%g %g\\n", -log(0), log(0) }'`)).toBe("+inf -inf");
    expect(sh("awk 'BEGIN { print 2**3, 2**3**2 }'")).toBe("8 512");
  });

  test("[REQ-098] a gawk-only feature is the proving ground's limit, in terrarium lines", () => {
    const { run } = engineLab();
    const r = run("srv-a2", `awk 'BEGIN { print gensub(/a/, "b", "g", "aaa") }'`);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("terrarium: ");
    expect(r.gaps).toContainEqual({ tool: "awk", feature: "function:gensub" });
  });
});

describe("a line stopped by a limit never ends quietly [REQ-098]", () => {
  const cases: [string, string, string][] = [
    ["an endless shell loop", "while true; do :; done", "steps"],
    ["an endless awk loop", "awk 'BEGIN { while (1) {} }'", "steps"],
    ["a fork bomb", ":(){ :|:& };:", "steps"],
    ["a string that doubles", "x=a; while true; do x=$x$x; done", "memory"],
    ["an awk string that doubles", `awk 'BEGIN { while (1) s = s s "x" }'`, "memory"],
    ["a huge brace expansion", "echo {1..100000} | wc -c", "expansion"],
    ["an endless source read whole", "cat /dev/zero", "output"],
  ];
  test.each(cases)("[REQ-098] %s: exit 124 and a terrarium line", (_name, line, kind) => {
    const { run } = engineLab();
    const r = run("srv-a2", line);
    expect(r.exitCode).toBe(124);
    expect(r.stderr).toMatch(/(^|\n)terrarium: /);
    expect(r.gaps).toContainEqual({ tool: "shell", feature: `limit:${kind}` });
  });

  test("[REQ-098] a refused write is the real shell's words and exit code", () => {
    const { run, sh } = engineLab();
    expect(run("srv-a2", "echo hi > /usr/x").stderr).toBe("bash: /usr/x: Permission denied");
    expect(sh("echo hi > /usr/x; echo rc=$?")).toContain("rc=1");
    expect(run("srv-a2", "echo hi >> /tmp/nodir/f").stderr).toBe(
      "bash: /tmp/nodir/f: No such file or directory",
    );
  });
});

describe("a limit stops the same line in the same place on every machine [REQ-098]", () => {
  const endless = "i=0; while true; do slowecho $i >> /tmp/f; i=$((i+1)); done";
  const outcome = (ms: number) => {
    slowMs = ms;
    const l = engineLab();
    const r = l.run("srv-a2", endless);
    slowMs = 0;
    const written = l.world.events().filter((e) => e.type === "host.act").length;
    return {
      code: r.exitCode,
      stderr: r.stderr,
      gaps: r.gaps,
      written,
      file: l.sh("wc -c < /tmp/f"),
    };
  };

  test("[REQ-098] an endless loop that keeps writing leaves the same file however slow the host is", () => {
    const fast = outcome(0);
    expect(fast.code).toBe(124);
    expect(fast.written).toBeGreaterThan(100);
    expect(outcome(0.2)).toEqual(fast);
    expect(outcome(0)).toEqual(fast);
  });

  test("[REQ-098] a smaller step limit stops earlier, at a counted place", () => {
    const small = engineLab({ limits: { steps: 500 } });
    expect(small.run("srv-a2", endless).exitCode).toBe(124);
    const big = engineLab({ limits: { steps: 1000 } });
    big.run("srv-a2", endless);
    expect(Number(small.sh("wc -c < /tmp/f"))).toBeLessThan(Number(big.sh("wc -c < /tmp/f")));
  });

  test("[REQ-098] the bytes of output are cut at the same byte", () => {
    const once = () => {
      const l = engineLab({ limits: { outputBytes: 1000 } });
      return l.run("srv-a2", "while true; do echo 0123456789; done").stdout.length;
    };
    expect(once()).toBe(once());
    expect(once()).toBeLessThanOrEqual(1000);
  });
});

describe("time and the world [REQ-098]", () => {
  test("[REQ-098] sleep passes world time, and date follows it", () => {
    const { sh, since } = engineLab();
    const [a, b] = sh("date +%s; sleep 5; date +%s").split("\n").map(Number);
    expect((b as number) - (a as number)).toBe(5);
    expect(since()).toBeGreaterThanOrEqual(5);
  });

  test("[REQ-098] in an operation sleep returns at once and says so", () => {
    const { run } = engineLab({ operation: true });
    const r = run("srv-a2", "sleep 5; echo done");
    expect(r.stdout).toContain("done");
    expect(r.gaps).toContainEqual({ tool: "shell", feature: "sleep" });
  });

  test("[REQ-098] timeout is measured in world time", () => {
    const { sh } = engineLab();
    expect(sh("timeout 2 sleep 100; echo rc=$?")).toBe("rc=124");
  });
});
