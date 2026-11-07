/**
 * "실험 시작" in one request (REQ-104, ADR-0127): the recommended settings for a world, put together as the same
 * recipe a person would have filled in, so `Experiments.create` checks and queues it like any other. No new kind of
 * experiment: it is an operation (ADR-0094) whose faults come from the world's scenario set, with the common tools,
 * five runs, the agent the person used last (else the built-in operator) and the real-time clock.
 */
import {
  type CreateExperimentRequest,
  InvalidInputError,
  type QuickExperimentRequest,
  type QuickExperimentView,
} from "@terrarium/core/contract";
import { ALL_SCENARIO_TEMPLATES } from "@terrarium/core/scenario";
import { DEFAULT_OPERATION, type FaultTemplate, templatesOf } from "@terrarium/core/session";
import { DEFAULT_TOOLSET } from "@terrarium/core/tools";
import { BlueprintIndex } from "@terrarium/core/world";
import { BUILTIN_HARNESS_ID } from "../adapters";
import { must, type PlatformContext, type Viewer } from "./context";

export const QUICK_RUNS = 5;
export const QUICK_HOURS = 1;
const MAX_FAULTS = 500;

export interface QuickPlan {
  readonly request: CreateExperimentRequest;
  readonly info: Omit<QuickExperimentView, "experimentId">;
}

/** The faults of the scenarios this world can build, restricted to the templates the screen named (when it named some). */
async function faultsOf(
  ctx: PlatformContext,
  worldId: string,
  ids: readonly string[] | undefined,
): Promise<{ faults: FaultTemplate[]; scenarios: number }> {
  const world = must(await ctx.store.getWorld(worldId), `세계 ${worldId}`);
  const index = new BlueprintIndex(world.blueprint);
  const wanted = ids ? new Set(ids) : undefined;
  const faults: FaultTemplate[] = [];
  let scenarios = 0;
  for (const t of ALL_SCENARIO_TEMPLATES) {
    if (wanted && !wanted.has(t.id)) continue;
    if (t.unavailable(index, ctx.catalog)) continue;
    const own = templatesOf(t.build(index, worldId, ctx.catalog).nodes);
    if (own.length === 0) continue;
    faults.push(...own);
    scenarios += 1;
  }
  return { faults: faults.slice(0, MAX_FAULTS), scenarios };
}

/** The agent the person ran an experiment with last, if it still answers; else the built-in operator. */
async function agentFor(
  ctx: PlatformContext,
  viewer: Viewer,
): Promise<{ harnessId: string; agentId: string; agentName: string; from: "recent" | "builtin" }> {
  for (const e of await ctx.store.listExperiments({ owner: viewer.name, limit: 20 })) {
    const harness = ctx.harnesses.get(e.recipe.harnessId);
    const agents = await harness?.agents().catch(() => undefined);
    const found = agents?.find((a) => a.id === e.recipe.agentId);
    if (found)
      return {
        harnessId: e.recipe.harnessId,
        agentId: found.id,
        agentName: found.name,
        from: "recent",
      };
  }
  const builtin = must(ctx.harnesses.get(BUILTIN_HARNESS_ID), "내장 기준 에이전트");
  const agents = await builtin.agents();
  const operator = agents.find((a) => a.id === "operator") ?? agents[0];
  if (!operator) throw new InvalidInputError("쓸 수 있는 에이전트가 없어요", []);
  return {
    harnessId: builtin.info.id,
    agentId: operator.id,
    agentName: operator.name,
    from: "builtin",
  };
}

export async function quickPlan(
  ctx: PlatformContext,
  viewer: Viewer,
  worldId: string,
  req: QuickExperimentRequest,
): Promise<QuickPlan> {
  const { faults, scenarios } = await faultsOf(ctx, worldId, req.templateIds);
  if (faults.length === 0)
    throw new InvalidInputError("이 세계에서 쓸 수 있는 시나리오가 없어요", [
      { path: "templateIds", message: "고장을 낼 시나리오가 하나도 없어요" },
    ]);
  const agent = await agentFor(ctx, viewer);
  const world = must(await ctx.store.getWorld(worldId), `세계 ${worldId}`);
  return {
    request: {
      name: `${world.name} · 권장 실험`.slice(0, 80),
      recipe: {
        worldId,
        scenarioId: "operation",
        harnessId: agent.harnessId,
        agentId: agent.agentId,
        // an operation needs the tool that reads new events
        tools: [...new Set([...DEFAULT_TOOLSET, "events_since"])],
        runs: QUICK_RUNS,
        operation: {
          ...DEFAULT_OPERATION,
          hours: QUICK_HOURS,
          pace: { mode: "realtime" },
          source: { kind: "set", faults },
        },
      },
    },
    info: {
      scenarios,
      faults: faults.length,
      runs: QUICK_RUNS,
      hours: QUICK_HOURS,
      harnessId: agent.harnessId,
      agentId: agent.agentId,
      agentName: agent.agentName,
      agentFrom: agent.from,
    },
  };
}
