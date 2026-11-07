/**
 * "바꾸기" on the world-built card (REQ-104, ADR-0127): the new-experiment form opens already holding the settings
 * that "실험 시작" would have used, so a person changes only what they want. The numbers are the server's
 * (`experiments-quick.ts`): the world's matching scenarios as an operation's fault set, the common tools plus the one
 * an operation needs, five runs, one hour of real time.
 */
import { ALL_SCENARIO_TEMPLATES } from "@terrarium/core/scenario";
import { DEFAULT_OPERATION, type OperationConfig, templatesOf } from "@terrarium/core/session";
import { DEFAULT_TOOLSET } from "@terrarium/core/tools";
import { type Blueprint, BlueprintIndex } from "@terrarium/core/world";
import { type Draft, emptyDraft } from "./experiment";
import { QUICK } from "./world-shape/short-flow";

/** The operation that runs the faults of the given scenario templates (all that fit the world when none are named). */
export function quickOperation(
  blueprint: Blueprint,
  templateIds?: readonly string[],
): OperationConfig | undefined {
  const index = new BlueprintIndex(blueprint);
  const wanted = templateIds ? new Set(templateIds) : undefined;
  const faults = ALL_SCENARIO_TEMPLATES.filter((t) => !wanted || wanted.has(t.id))
    .filter((t) => !t.unavailable(index))
    .flatMap((t) => templatesOf(t.build(index, "quick").nodes))
    .slice(0, 500);
  if (faults.length === 0) return undefined;
  return {
    ...DEFAULT_OPERATION,
    hours: QUICK.hours,
    pace: { mode: "realtime" },
    source: { kind: "set", faults },
  };
}

/** The draft "실험 시작" stands for. `agent` is the one the person used last, when there is one. */
export function quickDraft(
  worldId: string,
  operation: OperationConfig | undefined,
  agent?: { readonly harnessId: string; readonly agentId: string },
): Draft {
  return {
    ...emptyDraft(),
    worldId,
    tools: [...new Set([...DEFAULT_TOOLSET, "events_since"])],
    runs: QUICK.runs,
    harnessId: agent?.harnessId ?? "builtin",
    agentId: agent?.agentId ?? "operator",
    ...(operation ? { operation } : {}),
  };
}
