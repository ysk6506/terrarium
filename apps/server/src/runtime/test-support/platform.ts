/** A platform over memory, the in-process host and controllable harnesses, for runtime tests. */
import type { ExperimentEvent } from "@terrarium/core/contract";
import type {
  AgentInfo,
  AgentRunOutcome,
  AgentRunRequest,
  ExperimentStore,
  HarnessPort,
} from "@terrarium/core/experiments";
import { MemoryStore } from "@terrarium/core/experiments";
import { DEFAULT_TOOLSET } from "@terrarium/core/tools";
import { sampleBlueprint } from "../../../../../packages/core/src/world/test-support/sample";
import { buildAdapters, parseConfig, ScriptedHarness } from "../../adapters";
import type { Viewer } from "../context";
import { InProcessHost } from "../hosts";
import { Platform, type PlatformOptions } from "../platform";
import { sequentialStamps } from "./stamps";

export const YEONSU: Viewer = { name: "yeonsu", source: "proxy" };
export const JIMIN: Viewer = { name: "jimin", source: "self" };

/** A harness whose agent does whatever the test says. */
export class ScriptHarness implements HarnessPort {
  readonly info;
  readonly requests: AgentRunRequest[] = [];

  constructor(
    id: string,
    private readonly play: (req: AgentRunRequest) => Promise<AgentRunOutcome>,
    private readonly agentList: readonly AgentInfo[] = [{ id: "a", name: "에이전트" }],
    transport: "mcp" | "in-process" = "in-process",
  ) {
    this.info = {
      id,
      name: `하네스 ${id}`,
      kind: "test",
      description: "",
      toolTransport: transport,
      telemetry: "clickstack" as const,
    };
  }

  async agents(): Promise<readonly AgentInfo[]> {
    return this.agentList;
  }

  run(req: AgentRunRequest): Promise<AgentRunOutcome> {
    this.requests.push(req);
    return this.play(req);
  }
}

/** Waits until the run is stopped from outside. */
export const untilStopped = (req: AgentRunRequest): Promise<AgentRunOutcome> =>
  new Promise((resolve) => {
    if (req.signal.aborted) resolve({ status: "cancelled" });
    req.signal.addEventListener("abort", () => resolve({ status: "cancelled" }), { once: true });
  });

export async function until(
  check: () => Promise<boolean> | boolean,
  timeoutMs = 20_000,
): Promise<void> {
  const start = Date.now();
  while (!(await check())) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 20));
  }
}

export interface TestPlatform {
  readonly platform: Platform;
  readonly store: ExperimentStore;
  readonly events: ExperimentEvent[];
}

export function testPlatform(
  extra: readonly HarnessPort[] = [],
  options: Partial<PlatformOptions> = {},
  store: ExperimentStore = new MemoryStore(),
): TestPlatform {
  const adapters = buildAdapters(parseConfig({}), { store, env: {} });
  const platform = new Platform({
    adapters: { ...adapters, harnesses: [new ScriptedHarness("builtin", "내장"), ...extra] },
    host: new InProcessHost(),
    stamps: sequentialStamps(),
    graceMs: 50,
    ...options,
  });
  return { platform, store, events: [] };
}

/** The sample world and one built-in scenario on it, owned by yeonsu. */
export async function seed(p: Platform, templateId = "cooling-failure") {
  const { world } = await p.worlds.create(YEONSU, {
    name: "샘플 홀",
    blueprint: sampleBlueprint(),
  });
  const { scenario } = await p.scenarios.create(YEONSU, { worldId: world.id, templateId });
  return { world, scenario };
}

export const recipe = (
  worldId: string,
  scenarioId: string,
  extra: Record<string, unknown> = {},
) => ({
  worldId,
  scenarioId,
  harnessId: "builtin",
  agentId: "triage",
  tools: [...DEFAULT_TOOLSET],
  ...extra,
});

/** Wait for every run of an experiment to finish, then return its view. */
export async function settled(p: Platform, viewer: Viewer, id: string) {
  await until(async () => {
    const v = await p.experiments.view(viewer, id);
    return v.progress.finished === v.progress.total;
  });
  return p.experiments.view(viewer, id);
}
