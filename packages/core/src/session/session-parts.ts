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
import type { Toolbox, ToolResult } from "@terrarium/core/tools";
import type { FaultType, World, WorldEvent } from "@terrarium/core/world";
import type { HumanLine } from "./human-line";
import { HUMAN_CAUSE } from "./human-line";
import type { RunResult, SessionConfig, ShellOutside } from "./types";

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

/** The emulation gaps a call hit (ADR-0184), read from `run_command` and the switch CLI tools. Only the stable pair is kept. */
function gapsOf(result: ToolResult): Pick<ToolCallRecord, "gaps"> {
  if (!result.ok) return {};
  const gaps = (result.data as { gaps?: unknown } | undefined)?.gaps;
  if (!Array.isArray(gaps)) return {};
  const pairs = gaps.flatMap((g: { tool?: unknown; feature?: unknown }) =>
    typeof g?.tool === "string" && typeof g.feature === "string"
      ? [{ tool: g.tool, feature: g.feature }]
      : [],
  );
  return pairs.length > 0 ? { gaps: pairs } : {};
}

/** What the fake could not do in a call: shell commands outside the simulation (ADR-0117 decision 6) and emulation gaps (ADR-0184). */
export function outsideOf(
  tool: string,
  result: ToolResult,
): Pick<ToolCallRecord, "outside" | "gaps"> {
  const outside = (result.data as { outside?: unknown } | undefined)?.outside;
  const listed =
    tool === "run_command" && result.ok && Array.isArray(outside) && outside.length > 0
      ? { outside: outside.map(String) }
      : {};
  return { ...listed, ...gapsOf(result) };
}

/** What the fake shell could not do in a run, counted from the calls (ADR-0117 decision 6); undefined when `run_command` was not used. */
export function shellOutsideOf(calls: readonly ToolCallRecord[]): ShellOutside | undefined {
  const shell = calls.filter((c) => c.tool === "run_command");
  if (shell.length === 0) return undefined;
  const counts = new Map<string, number>();
  for (const what of shell.flatMap((c) => c.outside ?? []))
    counts.set(what, (counts.get(what) ?? 0) + 1);
  const items = [...counts]
    .map(([what, n]) => ({ what, n }))
    .sort((a, b) => b.n - a.n || a.what.localeCompare(b.what));
  return { commands: shell.length, count: items.reduce((s, i) => s + i.n, 0), items };
}

/** What the result shows apart from the score: escalation, runbook compliance and where the fake shell was thin. */
export function extrasOf(
  scenario: ScenarioDoc,
  sop: SessionConfig["sop"],
  toolbox: Toolbox,
  line: HumanLine,
  calls: readonly ToolCallRecord[],
): Pick<RunResult, "human" | "sop" | "shellOutside"> {
  const runbook = scenario.runbook;
  const outside = shellOutsideOf(calls);
  return {
    ...(toolbox.has("ask_human") ? { human: line.desk.summary() } : {}),
    ...(runbook ? { sop: { ...scoreSop(runbook, calls), mode: sop ?? "none" } } : {}),
    ...(outside ? { shellOutside: outside } : {}),
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
