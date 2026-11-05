import { InvalidValueError } from "@terrarium/core/kernel";
import { emptyScenario, SCENARIO_TEMPLATES } from "@terrarium/core/scenario";
import { DEFAULT_TOOLSET } from "@terrarium/core/tools";
import { BlueprintIndex } from "@terrarium/core/world";
import { afterAll, describe, expect, test } from "vitest";
import { sampleBlueprint } from "../../../../packages/core/src/world/test-support/sample";
import { InProcessHost, type PlainSessionConfig, plainConfig, type SessionHost } from "./hosts";
import { WorkerHost } from "./worker-host";

const config = (
  templateId = "cooling-failure",
  extra: Partial<PlainSessionConfig> = {},
): PlainSessionConfig => {
  const blueprint = sampleBlueprint();
  const template = SCENARIO_TEMPLATES.find((t) => t.id === templateId);
  if (!template) throw new Error(templateId);
  return {
    blueprint,
    scenario: template.build(new BlueprintIndex(blueprint), "sample"),
    tools: DEFAULT_TOOLSET,
    seed: 5,
    ...extra,
  };
};

async function play(host: SessionHost) {
  const s = await host.open(config());
  await s.call("list_alarms", {});
  await s.call("get_impact", { id: "crah-1" });
  const done = await s.call("submit_diagnosis", {
    rootCause: "crah-1",
    faultType: "cooling_unit_failure",
    summary: "정지",
  });
  expect(done.ended).toBe("diagnosed");
  expect(s.endedBy).toBe("diagnosed");
  const result = await s.finish();
  s.dispose();
  s.dispose();
  return result;
}

const workers = new WorkerHost({ size: 2 });
afterAll(() => workers.close());

describe("session hosts run the same session the same way [REQ-001] [REQ-032]", () => {
  test("in-process and worker threads give identical results", async () => {
    const local = new InProcessHost();
    const here = await play(local);
    const there = await play(workers);
    expect(there).toEqual(here);
    expect(here.score.total).toBe(90.9);
    expect(local.openCount).toBe(0);
    expect(workers.openCount).toBe(0);
  }, 60_000);

  test("sessions spread over workers; errors come back as the same kind of error", async () => {
    const opened = await Promise.all([
      workers.open(config()),
      workers.open(config("fan-failure-throttle")),
    ]);
    expect(workers.openCount).toBe(2);
    const bad = { ...config(), scenario: { ...emptyScenario("x", "sample"), nodes: [] } };
    await expect(workers.open(bad)).rejects.toBeInstanceOf(InvalidValueError);
    await expect(new InProcessHost().open(bad)).rejects.toBeInstanceOf(InvalidValueError);
    for (const s of opened) s.dispose();
    expect(workers.openCount).toBe(0);
    await expect(opened[0]?.call("list_alarms", {})).rejects.toThrow(
      "세션을 돌리던 워커가 멈췄어요",
    );
  }, 60_000);

  test("a realtime session follows the wall clock and ends on its own", async () => {
    const host = new InProcessHost();
    const s = await host.open(
      config("cooling-failure", { time: { kind: "realtime", speed: 3600 } }),
    );
    expect(s.endedBy).toBeUndefined();
    await new Promise((r) => setTimeout(r, 1200));
    expect(s.endedBy).toBe("time_limit");
    expect((await s.finish()).endReason).toBe("time_limit");
    s.dispose();
  });

  test("a worker that dies takes its sessions with it, and is replaced", async () => {
    const host = new WorkerHost({ size: 1 });
    const s = await host.open(config());
    const slot = (host as unknown as { slots: { worker: { terminate(): Promise<number> } }[] })
      .slots[0];
    await slot?.worker.terminate();
    await expect(s.call("list_alarms", {})).rejects.toThrow("세션을 돌리던 워커가 멈췄어요");
    const again = await host.open(config());
    expect((await again.call("list_alarms", {})).ok).toBe(true);
    await host.close();
    await expect(host.open(config())).rejects.toThrow("서버가 멈추는 중이에요");
    expect(() => new WorkerHost({ size: 0 })).toThrow("워커는 하나 이상이어야 해요");
  }, 60_000);

  test("configs crossing threads carry no catalog object", () => {
    const { blueprint, scenario, tools, seed } = config();
    expect(plainConfig({ blueprint, scenario, tools, seed })).toEqual({
      blueprint,
      scenario,
      tools,
      seed,
    });
    expect(() => plainConfig({ blueprint, scenario, tools, seed, catalog: {} as never })).toThrow(
      "hosted sessions use the built-in catalog",
    );
  });
});
