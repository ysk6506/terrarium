/** Pieces of a session's setup and result that need nothing of its state, kept out of `session.ts` (500-line limit). */

import type { RunOutcome } from "@terrarium/core/oracle";
import { CLUSTER_CAUSE } from "@terrarium/core/physics";
import {
  actionsOf,
  mainProblems,
  reaches,
  type ScenarioDoc,
  scoreSop,
  type ToolCallRecord,
} from "@terrarium/core/scenario";
import type { Toolbox } from "@terrarium/core/tools";
import type { FaultType, World, WorldEvent } from "@terrarium/core/world";
import type { HumanLine } from "./human-line";
import { HUMAN_CAUSE } from "./human-line";
import type { RunResult, SessionConfig } from "./types";

/** Background faults that no tool the agent has can reach do not happen when faults are limited to the tools given. */
export function faultSkipper(
  config: Pick<SessionConfig, "faultScope" | "scenario">,
  toolbox: Toolbox,
): ((type: FaultType) => boolean) | undefined {
  if (config.faultScope !== "inside") return undefined;
  const main = new Set<string>(mainProblems(config.scenario));
  return (type) => {
    const have = new Set(toolbox.list().map((t) => t.name));
    return !main.has(type) && !reaches(type, have);
  };
}

/** How an operation was held to its hours and its call limit, for the words of how it ended (empty for any other run). */
export function operationEndOf(
  config: Pick<SessionConfig, "operation">,
  task: { readonly maxToolCalls: number },
): Pick<RunOutcome, "operation"> {
  return config.operation
    ? { operation: { hours: config.operation.hours, maxToolCalls: task.maxToolCalls } }
    : {};
}

/** What the result shows apart from the score: escalation and runbook compliance. */
export function extrasOf(
  scenario: ScenarioDoc,
  sop: SessionConfig["sop"],
  toolbox: Toolbox,
  line: HumanLine,
  calls: readonly ToolCallRecord[],
): Pick<RunResult, "human" | "sop"> {
  const runbook = scenario.runbook;
  return {
    ...(toolbox.has("ask_human") ? { human: line.desk.summary() } : {}),
    ...(runbook ? { sop: { ...scoreSop(runbook, calls), mode: sop ?? "none" } } : {}),
  };
}

/** World events the agent caused (tools and protocol facades), as opposed to scenario, physics, the generator and the teams. */
const byAgent = (e: WorldEvent) =>
  e.cause !== "physics" &&
  e.cause !== CLUSTER_CAUSE &&
  e.cause !== "generator" &&
  !e.cause.startsWith("scenario:") &&
  !e.cause.startsWith("counterpart:") &&
  e.cause !== HUMAN_CAUSE;

/** What the agent's last call did to the world, as actions (REQ-007). */
export function effectsSince(world: World, before: number) {
  return actionsOf(world.events(before).filter(byAgent), (id, end) => {
    const link = world.index.link(id);
    return end === "from" ? link.from : link.to;
  });
}
