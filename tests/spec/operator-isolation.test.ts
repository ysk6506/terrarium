/**
 * [REQ-110] `operator` is a rule-based expert that sees only what any external agent sees (ADR-0133): the tools of the
 * endpoint it is handed. It takes a run request whose only handle on the world is a `ToolEndpoint`, and its source
 * imports nothing that holds the injected fault, the scenario, the oracle or the world: a test that fails the day
 * someone lets it peek. The reference solution (tests/spec/test-support/reference-solver.ts) is the opposite and lives
 * in the tests, where it is no agent anyone can pick.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentRunRequest, ToolCallOutcome } from "@terrarium/core/experiments";
import { describe, expect, test } from "vitest";
import { ScriptedHarness } from "../../apps/server/src/adapters";

const DIR = join(__dirname, "../../apps/server/src/adapters/harness");
const FILES = ["scripted-operator.ts", "baseline-layers.ts", "hands-off.ts"];

/** The module names a source file imports from. */
const importsOf = (file: string): string[] =>
  [...readFileSync(join(DIR, file), "utf8").matchAll(/from\s+"([^"]+)"/g)].map(
    (m) => m[1] as string,
  );

describe("operator sees only the tools [REQ-110]", () => {
  test("it imports the endpoint's types and its own helpers, nothing that knows the truth", () => {
    for (const file of FILES) {
      for (const from of importsOf(file)) {
        const allowed = from === "@terrarium/core/experiments" || from.startsWith("./");
        expect(allowed, `${file} imports ${from}`).toBe(true);
      }
    }
  });

  test("what it takes from the experiments package is types only", () => {
    for (const file of FILES) {
      const source = readFileSync(join(DIR, file), "utf8");
      const lines = source.split("\n").filter((l) => l.includes("@terrarium/core/experiments"));
      for (const l of lines) expect(l, file).toMatch(/^(import type|\} from)/);
      expect(source, file).not.toMatch(/import \{[^}]*\} from "@terrarium\/core\/experiments"/);
    }
  });

  test("it asks the endpoint and nothing else: any other reach into the request fails the test", async () => {
    const seen: string[] = [];
    const touched: string[] = [];
    const tools = new Proxy(
      {
        specs: ["list_alarms", "list_services", "wait", "submit_diagnosis"].map((name) => ({
          name,
        })) as never,
        call: async (name: string): Promise<ToolCallOutcome> => {
          seen.push(name);
          return { ok: false, error: "not in this test" } as ToolCallOutcome;
        },
      },
      {
        get(target, key) {
          if (key !== "specs" && key !== "call") touched.push(String(key));
          return Reflect.get(target, key);
        },
      },
    );
    const req: AgentRunRequest = {
      runId: "r",
      seed: 1,
      agentId: "operator",
      prompt: "조사하라",
      limits: { maxToolCalls: 20, timeLimitSeconds: 3600 },
      tools,
      signal: new AbortController().signal,
    };
    await new ScriptedHarness("builtin", "내장").run(req);
    expect(touched).toEqual([]);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen).toContain("list_alarms");
  });
});
