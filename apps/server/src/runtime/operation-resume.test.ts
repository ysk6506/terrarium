import { MemoryStore } from "@terrarium/core/experiments";
import { DEFAULT_OPERATION } from "@terrarium/core/session";
import { TOOL_SPECS, toolsForDomains } from "@terrarium/core/tools";
import { afterEach, describe, expect, test, vi } from "vitest";
import { serviceLab } from "../../../../packages/core/src/world/test-support/service-lab";
import type { Platform } from "./platform";
import { HANEUL, recipe, ScriptHarness, testPlatform } from "./test-support/platform";

const ALL = ["server", "network", "storage", "facility", "service_os", "virtualization"] as const;
const FAKE = {
  toFake: ["setTimeout", "setInterval", "clearTimeout", "clearInterval", "Date"] as (
    | "setTimeout"
    | "setInterval"
    | "clearTimeout"
    | "clearInterval"
    | "Date"
  )[],
};

afterEach(() => vi.useRealTimers());

/** A resident agent: waits and looks at the alarms, and notes every time it is asked to start. It leaves when it is stopped. */
function resident(prompts: string[]) {
  return new ScriptHarness("resident", async (req) => {
    prompts.push(req.prompt);
    const stopped = new Promise<"stop">((resolve) =>
      req.signal.addEventListener("abort", () => resolve("stop"), { once: true }),
    );
    const call = async (tool: string, args: Record<string, unknown>) =>
      Promise.race([req.tools.call(tool, args), stopped]);
    while (!req.signal.aborted) {
      const r = await call("wait", { seconds: 120 });
      if (r === "stop" || r.ended || !r.ok) break;
      await call("list_alarms", {});
    }
    return req.signal.aborted ? { status: "cancelled" } : { status: "finished" };
  });
}

async function begin(store: MemoryStore, prompts: string[], extra: Record<string, unknown> = {}) {
  const t = testPlatform([resident(prompts)], {}, store);
  const { world } = await t.platform.worlds.create(HANEUL, {
    name: "서비스 홀",
    blueprint: serviceLab(),
  });
  const created = await t.platform.experiments.create(HANEUL, {
    name: "운영 9분",
    recipe: recipe(world.id, "operation", {
      harnessId: "resident",
      agentId: "a",
      runs: 1,
      tools: toolsForDomains([...ALL], TOOL_SPECS),
      domains: [...ALL],
      operation: {
        ...DEFAULT_OPERATION,
        hours: 0.15,
        pace: { mode: "realtime" },
        rateScale: 300,
        ...extra,
      },
    }),
  });
  return { ...t, id: created.experiment.id, worldId: world.id };
}

const tick = async (seconds: number) => {
  for (let i = 0; i < seconds; i++) await vi.advanceTimersByTimeAsync(1000);
};

async function finished(platform: Platform, id: string) {
  for (let step = 0; step < 4000; step++) {
    await vi.advanceTimersByTimeAsync(1000);
    const v = await platform.experiments.view(HANEUL, id);
    if (v.progress.finished === v.progress.total) return v;
  }
  throw new Error("the operation did not end");
}

describe("an operation goes on after the server restarts [REQ-090]", () => {
  test("the stopped run is built again from its journal, records the gap and ends with the hours used", async () => {
    vi.useFakeTimers(FAKE);
    const store = new MemoryStore();
    const prompts: string[] = [];
    const first = await begin(store, prompts);
    await tick(40);
    const before = await first.platform.results.run(
      (await first.platform.experiments.view(HANEUL, first.id)).runs[0]?.id as string,
    );
    expect(before.run.error).toBeUndefined();
    expect(before.run.status).toBe("running");
    await first.platform.stop();
    const stopped = (await store.listRuns(first.id))[0];
    expect(stopped?.status).toBe("running");
    expect((await store.readJournal(stopped?.id as string)).entries.length).toBeGreaterThan(5);

    // three minutes with the server down
    vi.setSystemTime(Date.now() + 180_000);
    const second = testPlatform([resident(prompts)], {}, store);
    const recovered = await second.platform.start();
    expect(recovered).toEqual({ resumed: 1, interrupted: 0 });
    const view = await finished(second.platform, first.id);
    const run = await second.platform.results.run(view.runs[0]?.id as string);
    expect(run.run.status).toBe("completed");
    expect(run.run.result?.endReason).toBe("time_limit");
    // the hours were used up: the result says so in an operation's words, not as a time limit that was exceeded
    expect(run.run.result?.score.summary).toContain("운영 시간 끝(9분)");
    expect(run.analysis.endLabel).toBe("운영 시간 끝(9분)");
    const links = (run.run.result?.events ?? []).flatMap((e) => (e.kind === "link" ? [e] : []));
    expect(links.map((l) => l.what)).toEqual(["lost", "resumed"]);
    const gap = links[1]?.gapSeconds ?? 0;
    expect(gap).toBeGreaterThanOrEqual(180);
    expect(gap).toBeLessThan(200);
    // the agent was asked to go on, not to start over
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain("events_since(0)");
    // the record is one record: the world time never goes back
    const times = (run.run.result?.events ?? []).map((e) => e.t);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(await store.readJournal(run.run.id)).toEqual({ entries: [] });
  }, 90_000);

  test("it is the same run the world would have had without the stop", async () => {
    vi.useFakeTimers(FAKE);
    const plainStore = new MemoryStore();
    const plain = await begin(plainStore, []);
    const a = await finished(plain.platform, plain.id);
    const whole = await plain.platform.results.run(a.runs[0]?.id as string);

    const store = new MemoryStore();
    const first = await begin(store, []);
    await tick(30);
    await first.platform.stop();
    const second = testPlatform([resident([])], {}, store);
    await second.platform.start();
    const view = await finished(second.platform, first.id);
    const cut = await second.platform.results.run(view.runs[0]?.id as string);
    const faults = (r: typeof whole) =>
      (r.run.result?.events ?? []).flatMap((e) =>
        e.kind === "world" && e.cause === "generator" ? [e.t] : [],
      );
    expect(faults(cut)).toEqual(faults(whole));
    expect(cut.run.result?.operation?.planned).toBe(whole.run.result?.operation?.planned);
  }, 120_000);

  test("a run whose world changed cannot go on and says why; one without a journal ends as before", async () => {
    vi.useFakeTimers(FAKE);
    const store = new MemoryStore();
    const first = await begin(store, []);
    await tick(10);
    await first.platform.stop();
    const stopped = (await store.listRuns(first.id))[0];
    const runId = stopped?.id as string;
    const entries = (await store.readJournal(runId)).entries.map((e) =>
      e[0] === "h" ? (["h", "other-world", e[2]] as const) : e,
    );
    await store.deleteJournal(runId);
    await store.appendJournal(runId, entries, new Date().toISOString());
    const second = testPlatform([resident([])], {}, store);
    await second.platform.start();
    const failed = await finished(second.platform, first.id);
    const run = await store.getRun(failed.runs[0]?.id as string);
    expect(run?.status).toBe("failed");
    expect(run?.error).toContain("서버가 멈춰 중단됐어요");
    expect(run?.error).toContain("세계 버전이 바뀌어");

    const bare = new MemoryStore();
    const lone = await begin(bare, []);
    await tick(5);
    await lone.platform.stop();
    const loneRun = (await bare.listRuns(lone.id))[0];
    await bare.deleteJournal(loneRun?.id as string);
    const third = testPlatform([resident([])], {}, bare);
    expect(await third.platform.start()).toEqual({ resumed: 0, interrupted: 1 });
  }, 60_000);
});
