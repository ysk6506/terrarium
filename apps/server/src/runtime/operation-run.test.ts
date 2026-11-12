import { DEFAULT_OPERATION } from "@terrarium/core/session";
import { TOOL_SPECS, toolsForDomains } from "@terrarium/core/tools";
import { afterEach, describe, expect, test, vi } from "vitest";
import { serviceLab } from "../../../../packages/core/src/world/test-support/service-lab";
import type { Platform } from "./platform";
import { HANEUL, recipe, ScriptHarness, testPlatform } from "./test-support/platform";

/** The wall clock is the test's: a second of it per step, so hours of an operation pass in moments. */
async function finished(platform: Platform, id: string) {
  for (let step = 0; step < 20_000; step++) {
    await vi.advanceTimersByTimeAsync(1000);
    const v = await platform.experiments.view(HANEUL, id);
    if (v.progress.finished === v.progress.total) return v;
  }
  throw new Error("the operation did not end");
}

afterEach(() => vi.useRealTimers());

const ALL = ["server", "network", "storage", "facility", "service_os", "virtualization"] as const;

async function operate(
  extra: Record<string, unknown> = {},
  agentId = "operator",
  harnesses: ScriptHarness[] = [],
  harnessId = "builtin",
) {
  vi.useFakeTimers({
    toFake: ["setTimeout", "setInterval", "clearTimeout", "clearInterval", "Date"],
  });
  const t = testPlatform(harnesses);
  const { world } = await t.platform.worlds.create(HANEUL, {
    name: "서비스 홀",
    blueprint: serviceLab(),
  });
  const created = await t.platform.experiments.create(HANEUL, {
    name: "운영 8분",
    recipe: recipe(world.id, "operation", {
      harnessId,
      agentId,
      runs: 1,
      tools: toolsForDomains([...ALL], TOOL_SPECS),
      domains: [...ALL],
      operation: {
        ...DEFAULT_OPERATION,
        hours: 1,
        pace: { mode: "fast", speed: 60 },
        rateScale: 400,
        ...extra,
      },
    }),
  });
  const view = await finished(t.platform, created.experiment.id);
  const run = await t.platform.results.run(view.runs[0]?.id as string);
  return { run: run.run, experiment: created.experiment, t };
}

describe("an operation experiment runs the resident operator for its hours [REQ-090]", () => {
  test("it ends when the hours are used, with generated faults, metrics and a key that carries the pace", async () => {
    const { run, experiment } = await operate();
    expect(run.result?.endReason).toBe("time_limit");
    const op = run.result?.operation;
    expect(op?.planned).toBeGreaterThan(0);
    expect(op?.metrics.incidents).toBe(op ? op.planned - op.left : 0);
    expect(op?.metrics.calls).toBeGreaterThan(0);
    expect(experiment.recipe.scenarioId).toBe("operation");
    expect(experiment.snapshot.scenarioName).toContain("빨리 감기 60배");
    expect(run.result?.events?.some((e) => e.kind === "world" && e.cause === "generator")).toBe(
      true,
    );
  }, 60_000);

  test("another pace is another benchmark set; the instruction is not part of the key", async () => {
    const a = await operate({ instruction: "서비스부터 살려요" });
    const b = await operate({ instruction: "다르게 써요" });
    const c = await operate({ pace: { mode: "realtime" }, hours: 0.02 });
    expect(a.experiment.benchmarkKey).toBe(b.experiment.benchmarkKey);
    expect(a.experiment.benchmarkKey).not.toBe(c.experiment.benchmarkKey);
  }, 90_000);

  test("a harness that stops before the hours are used is asked again, and the record says it was lost and came back", async () => {
    let starts = 0;
    const flaky = new ScriptHarness("flaky", async (req) => {
      starts++;
      await req.tools.call("events_since", { cursor: 0 });
      if (starts === 1) return { status: "error", message: "하네스가 응답하지 않아요" };
      while (!req.signal.aborted) {
        const r = await req.tools.call("wait", { seconds: 300 });
        if (r.ended || !r.ok) break;
      }
      return { status: "finished" };
    });
    const { run } = await operate({ hours: 0.2 }, "a", [flaky], "flaky");
    expect(starts).toBe(2);
    expect(run.result?.endReason).toBe("time_limit");
    const links = (run.result?.events ?? []).filter((e) => e.kind === "link");
    expect(links.map((e) => (e.kind === "link" ? e.what : ""))).toEqual(["lost", "back"]);
    expect(links[0]).toMatchObject({ reason: "하네스가 응답하지 않아요" });
  }, 60_000);

  test("an operation without events_since is refused, with the way out", async () => {
    const t = testPlatform();
    const { world } = await t.platform.worlds.create(HANEUL, {
      name: "서비스 홀",
      blueprint: serviceLab(),
    });
    const refused = await t.platform.experiments
      .create(HANEUL, {
        name: "툴 없음",
        recipe: recipe(world.id, "operation", {
          agentId: "operator",
          tools: ["list_alarms", "wait"],
          operation: DEFAULT_OPERATION,
        }),
      })
      .catch((err: { issues?: { message: string }[] }) => err);
    expect(JSON.stringify((refused as { issues?: unknown }).issues)).toContain("events_since");
  });

  test("waking on every alarm needs a harness that can take it; the built-in one can, others say why not", async () => {
    const quiet = new ScriptHarness("plain", async () => ({ status: "finished" }));
    const t = testPlatform([quiet]);
    const { world } = await t.platform.worlds.create(HANEUL, {
      name: "서비스 홀",
      blueprint: serviceLab(),
    });
    await expect(
      t.platform.experiments.create(HANEUL, {
        name: "깨우기",
        recipe: recipe(world.id, "operation", {
          harnessId: "plain",
          agentId: "a",
          operation: { ...DEFAULT_OPERATION, wakeOnAlarm: true },
        }),
      }),
    ).rejects.toThrow(/알람마다 깨우기/);
  });
});
