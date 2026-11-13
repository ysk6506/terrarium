/**
 * The action gate (REQ-123, ADR-0199): the one place a call passes before it reaches a tool, where a level of `view`
 * stops the calls that change the world. It uses the judgement the record already carries (`callEffect`, which for a
 * tool that reads and writes, like the shell or a Redfish request, looks at the arguments), so what it stops is
 * exactly what the record calls an action. Handing over, asking, tickets, waiting and the diagnosis are not actions.
 * A stopped call is answered as what it is, a rule of the experiment, never as a failure of the tool.
 */
import { isWorldAction, type ToolResult, type ToolSpec } from "@terrarium/core/tools";
import type { PermissionLevel } from "./model";

/** What an agent that may only look can still do, in the words of the answer it gets; `""` is always possible. */
const MAY: ReadonlyArray<readonly [string, string]> = [
  ["", "look at anything"],
  ["submit_diagnosis", "submit your diagnosis"],
  ["ask_human", "ask a person"],
  ["escalate", "hand the work to the team that owns it"],
];

/** The answer to a call that the gate stopped, with what the agent can still do among the tools it has. */
export function deniedAnswer(has: (tool: string) => boolean): ToolResult {
  const may = MAY.filter(([tool]) => tool === "" || has(tool)).map(([, what]) => what);
  return {
    ok: false,
    error:
      "Permission denied: this experiment entrusts viewing only, so a call that changes the world is not made. " +
      "That is a rule of the experiment, not a failure of the tool, and nothing was changed. " +
      `You can still ${may.join(", ")}.`,
  };
}

/** Whether the level stops this call; only for a tool the agent has (a tool it does not have gets its own answer). */
export function gateStops(
  level: PermissionLevel | undefined,
  has: (tool: string) => boolean,
  tool: string,
  args: Readonly<Record<string, unknown>>,
): boolean {
  return level === "view" && has(tool) && isWorldAction(tool, args);
}

/** The tools as the agent is told about them: under a level of `view`, the ones that can change the world say it will be refused. */
export function gatedSpecs(
  specs: readonly ToolSpec[],
  level: PermissionLevel | undefined,
): ToolSpec[] {
  if (level !== "view") return [...specs];
  return specs.map((s) =>
    s.mutating
      ? {
          ...s,
          description: `${s.description} This experiment entrusts viewing only: a call that changes the world is refused and nothing is changed.`,
        }
      : s,
  );
}
